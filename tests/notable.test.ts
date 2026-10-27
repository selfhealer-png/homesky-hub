import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aboutType, approaching, classify, elevationDeg, shouldAlert, typeArticleTitle, typeName, whereToLook } from '../src/shared/notable';
import type { Aircraft } from '../src/shared/types';

const plane = (p: Partial<Aircraft>): Aircraft => ({
  hex: 'abc123', callsign: 'BAW1', registration: null, type: 'A320', lat: 0, lon: 0,
  altFt: 30000, groundSpeedKt: 450, trackDeg: 0, verticalRateFpm: 0, squawk: null, emergency: false,
  distanceNm: 10, bearingDeg: 315, ...p,
});

test('emergencies come first and say what the squawk means', () => {
  assert.deepEqual(classify(plane({ emergency: true, squawk: '7700', type: 'A3ST' })), { kind: 'emergency', title: 'Squawk 7700: emergency' });
  assert.equal(classify(plane({ emergency: true, squawk: null }))?.title, 'Emergency declared');
});

test('rare types, then military, then special operators', () => {
  assert.equal(classify(plane({ type: 'A337' }))?.title, 'Airbus Beluga XL');
  assert.equal(classify(plane({ type: 'B52', military: true }))?.kind, 'rare');
  assert.equal(classify(plane({ type: 'H64', military: true }))?.kind, 'military');
  assert.equal(classify(plane({ type: 'EC35', interesting: true }))?.kind, 'special');
  assert.equal(classify(plane({})), null);
});

test('alert levels', () => {
  const rare = classify(plane({ type: 'SPIT' }));
  const mil = classify(plane({ military: true }));
  assert.equal(shouldAlert(rare, 'off'), false);
  assert.equal(shouldAlert(rare, 'rare'), true);
  assert.equal(shouldAlert(mil, 'rare'), false);
  assert.equal(shouldAlert(mil, 'all'), true);
  assert.equal(shouldAlert(null, 'all'), false);
});

test('where to look', () => {
  // 10 nm out at 30,000 ft is about 26° up.
  assert.equal(Math.round(elevationDeg(plane({}))!), 26);
  assert.equal(whereToLook(plane({})), 'Look north-west, 26° up');
  assert.equal(whereToLook(plane({ distanceNm: 0.3 })), 'Overhead');
  assert.equal(whereToLook(plane({ distanceNm: 40, altFt: 20000, bearingDeg: 90 })), 'Low to the east');
  assert.equal(whereToLook(plane({ altFt: null })), null);
});

test('heading this way', () => {
  // North-west of home, flying south-east: towards home.
  assert.equal(approaching(plane({ trackDeg: 135 })), true);
  assert.equal(approaching(plane({ trackDeg: 315 })), false);
});

test('articles for rare types and common airliners', () => {
  assert.equal(typeArticleTitle('A337'), 'Airbus BelugaXL');
  assert.equal(typeArticleTitle('B738'), 'Boeing 737 Next Generation');
  assert.equal(typeArticleTitle('B38M'), 'Boeing 737 MAX');
  assert.equal(typeArticleTitle('A20N'), 'Airbus A320neo family');
  assert.equal(typeArticleTitle('A320'), 'Airbus A320 family');
  assert.equal(typeArticleTitle('C172'), null);
  assert.equal(typeArticleTitle(null), null);
});

test('a search result must be about the type', () => {
  assert.equal(aboutType('Boeing P-8 Poseidon', 'Boeing 737NG 8AS/W'), false);
  assert.equal(aboutType('Boeing 737 Next Generation', 'Boeing 737NG 8AS/W'), true);
  assert.equal(aboutType('Fairchild Swearingen Metroliner', 'Swearingen Metro III'), true);
  assert.equal(aboutType('List of Boeing 737 operators', 'Boeing 737-800'), false);
});

test('type names in ordinary case', () => {
  assert.equal(typeName('BOEING 737-800'), 'Boeing 737-800');
  assert.equal(typeName('AIRBUS HELICOPTERS EC-135/635'), 'Airbus Helicopters EC-135/635');
  assert.equal(typeName('MCDONNELL DOUGLAS AH-64 Apache'), 'McDonnell Douglas AH-64 Apache');
  assert.equal(typeName('BAE 146'), 'BAE 146');
  assert.equal(typeName('  '), null);
});
