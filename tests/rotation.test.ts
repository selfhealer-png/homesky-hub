import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickRotation, screenOrder } from '../src/shared/rotation';
import type { ScreenId } from '../src/shared/settings';
import type { HubConfig } from '../src/shared/types';

const screen = (id: ScreenId, extra: { quiet?: boolean; isAvailable?(c: HubConfig): boolean } = {}) => ({ id, ...extra });
const ALL = [
  screen('home', { quiet: true }),
  screen('weather'),
  screen('airport', { isAvailable: c => c.airports.length > 0 }),
  screen('clock', { quiet: true }),
  screen('wiki'),
];
const config = (screensOff: ScreenId[] = [], order: ScreenId[] = screenOrder()) => ({ screensOff, order, airports: [] } as unknown as HubConfig);
const ids = (list: Array<{ id: ScreenId }>) => list.map(s => s.id);

test('every available screen is in the rotation by default', () => {
  assert.deepEqual(ids(pickRotation(ALL, config(), false)), ['home', 'weather', 'clock', 'wiki']);
});

test('switched-off screens leave the rotation', () => {
  assert.deepEqual(ids(pickRotation(ALL, config(['weather', 'wiki']), false)), ['home', 'clock']);
});

test('quiet hours keep only the calm screens that are switched on', () => {
  assert.deepEqual(ids(pickRotation(ALL, config(['home']), true)), ['clock']);
});

test('a pinned screen stays even when switched off or not calm', () => {
  const wiki = ALL[4];
  assert.deepEqual(ids(pickRotation(ALL, config(['wiki']), true, wiki)), ['home', 'clock', 'wiki']);
});

test('with everything off, the display shows the clock', () => {
  assert.deepEqual(ids(pickRotation(ALL, config(['home', 'weather', 'airport', 'clock', 'wiki']), false)), ['clock']);
});

test('screens rotate in the saved order', () => {
  assert.deepEqual(ids(pickRotation(ALL, config([], screenOrder(['wiki', 'clock', 'home'])), false)), ['wiki', 'clock', 'home', 'weather']);
});

test('the default order is every screen once', () => {
  assert.deepEqual(screenOrder(), ['home', 'weather', 'rain', 'board', 'radar', 'airport', 'tonight', 'clock', 'photos', 'wiki']);
});

test('a screen missing from a saved order goes in after the one it follows by default', () => {
  // Saved before the rain map existed, with weather moved to the end.
  const saved = ['home', 'board', 'radar', 'airport', 'tonight', 'clock', 'photos', 'wiki', 'weather'];
  assert.deepEqual(screenOrder(saved), ['home', 'board', 'radar', 'airport', 'tonight', 'clock', 'photos', 'wiki', 'weather', 'rain']);
});

test('unknown and repeated ids are dropped from a saved order', () => {
  const order = screenOrder(['clock', 'nonsense', 'clock', 42]);
  assert.equal(order.length, 10);
  assert.equal(order.filter(id => id === 'clock').length, 1);
  assert.ok(!order.includes('nonsense' as ScreenId));
});
