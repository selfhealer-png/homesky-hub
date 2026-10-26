import assert from 'node:assert/strict';
import { test } from 'node:test';
import { angleBetween, arrivalStatus, departureStatus, etaMinutes, mayBeArriving, mayBeDeparting } from '../src/shared/arrivals';
import type { Aircraft } from '../src/shared/types';

const plane = (p: Partial<Aircraft>): Aircraft => ({
  hex: 'abc123', callsign: 'BAW1', registration: null, type: 'A320', lat: 0, lon: 0,
  altFt: 30000, groundSpeedKt: 450, trackDeg: 0, verticalRateFpm: 0, squawk: null, emergency: false,
  distanceNm: 50, bearingDeg: 180, ...p,
});

test('angles wrap round north', () => {
  assert.equal(angleBetween(350, 10), 20);
  assert.equal(angleBetween(10, 350), 20);
  assert.equal(angleBetween(90, 270), 180);
});

test('arrival status follows height and distance', () => {
  assert.equal(arrivalStatus(plane({ altFt: 36000, distanceNm: 90 })), 'en route');
  assert.equal(arrivalStatus(plane({ altFt: 24000, distanceNm: 70, verticalRateFpm: -1800 })), 'descending');
  assert.equal(arrivalStatus(plane({ altFt: 6000, distanceNm: 22 })), 'approach');
  assert.equal(arrivalStatus(plane({ altFt: 1500, distanceNm: 4 })), 'landing');
  assert.equal(arrivalStatus(plane({ altFt: null, distanceNm: 1 })), 'landed');
});

test('departure status follows height and climb', () => {
  assert.equal(departureStatus(plane({ altFt: null, distanceNm: 1 })), 'taxiing');
  assert.equal(departureStatus(plane({ altFt: 1800, distanceNm: 4 })), 'takeoff');
  assert.equal(departureStatus(plane({ altFt: 14000, distanceNm: 30, verticalRateFpm: 2000 })), 'climbing');
  assert.equal(departureStatus(plane({ altFt: 37000, distanceNm: 75 })), 'departed');
});

test('ETA allows for the approach and slows down close in', () => {
  assert.equal(etaMinutes(plane({ altFt: null })), 0);
  // 100 nm at 450 kt is 13 min in a straight line; the descent adds a few.
  const far = etaMinutes(plane({ distanceNm: 100, groundSpeedKt: 450 }));
  assert.ok(far >= 15 && far <= 20, `far ETA ${far}`);
  // 10 nm out at 160 kt: about 4 min.
  const near = etaMinutes(plane({ distanceNm: 10, groundSpeedKt: 160, altFt: 3000 }));
  assert.ok(near >= 3 && near <= 5, `near ETA ${near}`);
});

test('only planes pointing at the airport, or low nearby, are looked up as arrivals', () => {
  // South of the airport (bearing 180 from it), flying north: towards it.
  assert.equal(mayBeArriving(plane({ bearingDeg: 180, trackDeg: 10 })), true);
  // Same place, flying south: away.
  assert.equal(mayBeArriving(plane({ bearingDeg: 180, trackDeg: 180 })), false);
  // Close and low, on a downwind leg pointing away.
  assert.equal(mayBeArriving(plane({ bearingDeg: 180, trackDeg: 180, distanceNm: 12, altFt: 5000 })), true);
  // Parked at the gate.
  assert.equal(mayBeArriving(plane({ altFt: null, distanceNm: 1, groundSpeedKt: 0 })), false);
});

test('departures are near and moving away', () => {
  assert.equal(mayBeDeparting(plane({ bearingDeg: 180, trackDeg: 175, distanceNm: 20, altFt: 9000, verticalRateFpm: 2500 })), true);
  assert.equal(mayBeDeparting(plane({ bearingDeg: 180, trackDeg: 0, distanceNm: 20, altFt: 9000 })), false);
  assert.equal(mayBeDeparting(plane({ bearingDeg: 180, trackDeg: 175, distanceNm: 150 })), false);
});
