import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeMisfit } from '../src/shared/routeCheck';

const LHR = { lat: 51.47, lon: -0.454 };
const FAO = { lat: 37.014, lon: -7.966 };
const CGN = { lat: 50.866, lon: 7.143 };
const JFK = { lat: 40.64, lon: -73.779 };
const MUC = { lat: 48.354, lon: 11.786 };
const CDG = { lat: 49.01, lon: 2.55 };
const HND = { lat: 35.552, lon: 139.78 };

const at = (lat: number, lon: number, altFt: number | null, trackDeg: number | null, onGround = false) => ({ lat, lon, altFt, trackDeg, onGround });

test('landing at an airport that is neither end of the route', () => {
  // The callsign looked up to Faro → Cologne, but it's on short final at Heathrow.
  assert.equal(routeMisfit(at(51.47, -0.6, 425, 90), FAO, CGN), 'low away from both ends');
});

test('arriving and departing low near the right airport is fine', () => {
  assert.equal(routeMisfit(at(51.47, -0.6, 2000, 90), JFK, LHR), null);
  assert.equal(routeMisfit(at(51.5, -0.2, 3500, 80), LHR, MUC), null);
});

test('on the ground: only at one end of the route', () => {
  assert.equal(routeMisfit(at(51.47, -0.45, null, 270, true), LHR, MUC), null);
  assert.equal(routeMisfit(at(51.47, -0.45, null, 270, true), FAO, CGN), 'on the ground elsewhere');
});

test('mid-flight, it should be heading for the destination', () => {
  // Over the Channel between London and Munich, at cruise.
  assert.equal(routeMisfit(at(51.0, 2.5, 36000, 110), LHR, MUC), null);
  assert.equal(routeMisfit(at(51.0, 2.5, 36000, 290), LHR, MUC), 'heading away');
});

test('long-haul flights get more leeway, as they route round closed airspace', () => {
  // Paris to Tokyo over Frankfurt, heading south-east to go round Russia: 70° off the great circle.
  assert.equal(routeMisfit(at(50.03, 8.57, 35000, 112), CDG, HND), null);
  // Still not flying the opposite way.
  assert.equal(routeMisfit(at(50.03, 8.57, 35000, 250), CDG, HND), 'heading away');
});

test('turning out of the departure area is not counted against it', () => {
  // 40 km out of Heathrow, still turning towards Munich.
  assert.equal(routeMisfit(at(51.75, -0.6, 9000, 340), LHR, MUC), null);
});

test('no altitude from the feed: only the heading is checked', () => {
  assert.equal(routeMisfit(at(51.47, -0.6, null, 90), FAO, CGN), null);
});

test('far off the line between the two airports', () => {
  assert.equal(routeMisfit(at(30, 20, 36000, 270), LHR, JFK), 'off the line');
});
