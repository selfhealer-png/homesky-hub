import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addToTally, compassWord, lookUpText, nextOverhead, tallyLines, targetText, windAloft } from '../src/shared/skyFacts';
import type { Aircraft } from '../src/shared/types';

const plane = (o: Partial<Aircraft>): Aircraft => ({
  hex: 'abc123', callsign: 'TST1', registration: null, type: 'A320', lat: 0, lon: 0, altFt: 10_000,
  groundSpeedKt: 300, trackDeg: 0, verticalRateFpm: 0, squawk: null, emergency: false, distanceNm: 5, bearingDeg: 180, ...o,
} as Aircraft);

test('look up: a plane heading straight for home goes over, and when', () => {
  // 5 nm south of home, flying north at 300 kt: over home in 60 s.
  const p = nextOverhead([plane({})]);
  assert.ok(p);
  assert.ok(Math.abs(p.inSec - 60) < 1);
  assert.ok(p.distKm < 0.1);
  assert.match(lookUpText(p, 'TST1'), /^TST1 goes over in 1 min: look straight up$/);
});

test('look up: a plane flying away is closest now; one passing over beats one passing near', () => {
  const away = plane({ hex: 'a', bearingDeg: 180, trackDeg: 180, distanceNm: 2 });
  const p = nextOverhead([away]);
  assert.equal(p?.inSec, 0);
  const near = plane({ hex: 'n', bearingDeg: 90, distanceNm: 3, trackDeg: 0 }); // passes 3 nm east, now
  const over = plane({ hex: 'o', bearingDeg: 180, distanceNm: 10, trackDeg: 0 }); // over home in 2 min
  assert.equal(nextOverhead([near, over])?.aircraft.hex, 'o');
  assert.equal(nextOverhead([plane({ altFt: null, onGround: true })]), null);
});

test('autopilot target: only when climbing or descending to it', () => {
  assert.equal(targetText(plane({ altFt: 12_000, navAltFt: 35_000 })), 'climbing to 35,000 ft');
  assert.equal(targetText(plane({ altFt: 9_000, navAltFt: 4_000 })), 'descending to 4,000 ft');
  assert.equal(targetText(plane({ altFt: 36_000, navAltFt: 36_000 })), null);
  assert.equal(targetText(plane({ navAltFt: null })), null);
});

test('wind aloft: from the highest reports, averaged as directions', () => {
  const w = windAloft([
    plane({ hex: '1', altFt: 38_000, windFromDeg: 350, windKt: 100 }),
    plane({ hex: '2', altFt: 37_000, windFromDeg: 10, windKt: 100 }),
    plane({ hex: '3', altFt: 24_000, windFromDeg: 180, windKt: 40 }),
    plane({ hex: '4', altFt: 39_000 }),
  ]);
  assert.ok(w);
  assert.equal(w.reports, 2);
  assert.equal(compassWord(w.fromDeg), 'north');
  assert.ok(w.kmh > 180 && w.kmh < 186);
  assert.equal(windAloft([plane({ altFt: 5_000, windFromDeg: 90, windKt: 20 })]), null);
});

test('today: counts each plane once, keeps records, and starts again each day', () => {
  const name = (a: Aircraft) => a.callsign!;
  let t = addToTally(null, '2026-11-25', [plane({ hex: 'a', callsign: 'A1', altFt: 30_000, year: 1998 }), plane({ hex: 'b', callsign: 'B1', altFt: 41_000, groundSpeedKt: 560 })], name);
  t = addToTally(t, '2026-11-25', [plane({ hex: 'a', callsign: 'A1', altFt: 31_000 })], name);
  assert.equal(t.seen.length, 2);
  assert.deepEqual(t.highest, { name: 'B1', value: 41_000 });
  assert.equal(t.fastest?.name, 'B1');
  assert.equal(t.oldest?.value, 1998);
  assert.match(tallyLines(t)[0], /^2 planes so far/);
  assert.equal(addToTally(t, '2026-11-26', [], name).seen.length, 0);
});
