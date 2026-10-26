import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inQuietHours, minutesIn, nightPhase } from '../src/shared/night';
import { DEFAULT_NIGHT } from '../src/shared/settings';

// Penrith, Cumbria: about 54.7°N. On 26 Oct 2026 (GMT) the sun sets around 16:40 and rises around 07:30.
const LAT = 54.66, LON = -2.75, TZ = 'Europe/London';
const at = (iso: string) => Date.parse(iso);
const phase = (iso: string, night = DEFAULT_NIGHT) => nightPhase(at(iso), LAT, LON, TZ, night);

test('quiet hours can run past midnight', () => {
  assert.equal(inQuietHours(23 * 60, '22:30', '06:30'), true);
  assert.equal(inQuietHours(3 * 60, '22:30', '06:30'), true);
  assert.equal(inQuietHours(6 * 60 + 30, '22:30', '06:30'), false);
  assert.equal(inQuietHours(12 * 60, '22:30', '06:30'), false);
});

test('quiet hours within one day, and none when both ends match', () => {
  assert.equal(inQuietHours(14 * 60, '13:00', '15:00'), true);
  assert.equal(inQuietHours(16 * 60, '13:00', '15:00'), false);
  assert.equal(inQuietHours(10 * 60, '07:00', '07:00'), false);
});

test('minutes follow the hub timezone, summer time included', () => {
  assert.equal(minutesIn(TZ, at('2026-07-01T21:30:00Z')), 22 * 60 + 30);
  assert.equal(minutesIn(TZ, at('2026-12-01T21:30:00Z')), 21 * 60 + 30);
});

test('day, then evening from sunset, then quiet hours', () => {
  assert.equal(phase('2026-10-26T12:00:00Z'), 'day');
  assert.equal(phase('2026-10-26T18:00:00Z'), 'evening');
  assert.equal(phase('2026-10-26T23:00:00Z'), 'quiet');
  assert.equal(phase('2026-10-27T06:45:00Z'), 'evening'); // quiet hours over, still before sunrise
  assert.equal(phase('2026-10-27T09:00:00Z'), 'day');
});

test('a summer evening stays day until the sun goes down', () => {
  assert.equal(phase('2026-06-21T19:00:00Z'), 'day'); // 20:00 BST, sun still up
  assert.equal(phase('2026-06-21T21:45:00Z'), 'quiet');
});

test('the modes', () => {
  assert.equal(phase('2026-10-26T23:00:00Z', { ...DEFAULT_NIGHT, mode: 'evening' }), 'evening');
  assert.equal(phase('2026-10-26T23:00:00Z', { ...DEFAULT_NIGHT, mode: 'off' }), 'day');
});
