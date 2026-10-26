import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heightAt, tideTurns } from '../src/shared/tides';

const QUARTER = 15 * 60_000;
const START = Date.parse('2026-10-26T00:00:00Z');
/** A curve sampled every 15 minutes from a function of hours since midnight. */
const curve = (hours: number, fn: (h: number) => number): Array<[string, number]> =>
  Array.from({ length: hours * 4 + 1 }, (_, i) => [new Date(START + i * QUARTER).toISOString(), Math.round(fn(i / 4) * 100) / 100]);

/** A semidiurnal tide: high water every 12 h 25 min. */
const PERIOD = 12.42;
const tide = (h: number) => 2 * Math.cos((2 * Math.PI * (h - 3)) / PERIOD);

test('finds alternating high and low water in a plain tide', () => {
  const turns = tideTurns(curve(26, tide));
  assert.deepEqual(turns.map(t => t.type), ['high', 'low', 'high', 'low']);
  // High water near 03:00, within a sample.
  assert.ok(Math.abs(Date.parse(turns[0].time) - (START + 3 * 3_600_000)) <= QUARTER);
  assert.equal(turns[0].height, 2);
});

test('a wobble near the turn is not a tide', () => {
  // A small dip and rise just after high water, as the model sometimes draws.
  const wobbly = (h: number) => tide(h) + (h > 3.4 && h < 4 ? 0.05 * Math.sin(((h - 3.4) / 0.6) * 2 * Math.PI) : 0);
  assert.deepEqual(tideTurns(curve(14, wobbly)).map(t => t.type), ['high', 'low']);
});

test('a real double high water keeps the higher of the two', () => {
  // Two peaks 90 minutes apart with a dip of a few centimetres between them (a Solent tide).
  const double = (h: number) => (h < 6 ? 1 - 0.3 * Math.abs(h - 3) + (Math.abs(h - 3) < 0.75 ? -0.04 * (1 - Math.abs(h - 3) / 0.75) : 0) + (h > 3 ? 0.02 : 0) : 1 - 0.3 * Math.abs(h - 3));
  const turns = tideTurns(curve(8, double));
  assert.equal(turns.filter(t => t.type === 'high').length, 1);
  assert.equal(turns[0].type, 'high');
});

test('reads the height between samples', () => {
  const heights: Array<[string, number]> = [['2026-10-26T00:00:00.000Z', 0], ['2026-10-26T00:15:00.000Z', 1]];
  assert.equal(heightAt(heights, START + 7.5 * 60_000), 0.5);
  assert.equal(heightAt(heights, START - 1), undefined);
});
