import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aqiLabel, inPollenSeason, peakPollen } from '../src/shared/air';

test('pollen season follows the hemisphere', () => {
  assert.equal(inPollenSeason(54.7, new Date('2026-06-15')), true);
  assert.equal(inPollenSeason(54.7, new Date('2026-10-23')), false);
  assert.equal(inPollenSeason(-33.9, new Date('2026-12-01')), true);
  assert.equal(inPollenSeason(-33.9, new Date('2026-06-15')), false);
});

test('the worst pollen kind wins, by level then count', () => {
  assert.deepEqual(peakPollen({ grass_pollen: [5, 60, 12], birch_pollen: [10, 20] }), { level: 'High', kind: 'grass' });
  assert.deepEqual(peakPollen({ grass_pollen: [2], mugwort_pollen: [35] }), { level: 'High', kind: 'weed' });
  assert.deepEqual(peakPollen({ grass_pollen: [0, 0] }), { level: 'Low', kind: 'grass' });
});

test('no pollen data (outside Europe) means no pollen line', () => {
  assert.equal(peakPollen({ grass_pollen: [null, null] }), undefined);
  assert.equal(peakPollen({}), undefined);
});

test('air quality labels follow the European AQI bands', () => {
  assert.equal(aqiLabel(12), 'Good');
  assert.equal(aqiLabel(45), 'Moderate');
  assert.equal(aqiLabel(130), 'Extremely poor');
});
