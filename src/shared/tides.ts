import type { TideTurn } from './types';

// High and low water from a tide curve sampled every 15 minutes. A plain search for peaks finds
// too many: the model wobbles near the turn, and some harbours (Poole, Southampton) really do
// have a double high or low water. So turns alternate high, low, high; of two highs in a row the
// higher is kept (the lower of two lows), and a rise or fall smaller than MIN_RANGE isn't a tide.

const MIN_RANGE = 0.08; // metres

export function tideTurns(heights: Array<[string, number]>): TideTurn[] {
  const turns: TideTurn[] = [];
  for (let i = 1; i < heights.length - 1; i++) {
    const [, before] = heights[i - 1], [time, h] = heights[i], [, after] = heights[i + 1];
    const type = h >= before && h > after ? 'high' : h <= before && h < after ? 'low' : null;
    if (!type) continue;
    const last = turns[turns.length - 1];
    if (last && last.type === type) {
      if (type === 'high' ? h > last.height : h < last.height) turns[turns.length - 1] = { time, height: h, type };
    } else if (last && Math.abs(h - last.height) < MIN_RANGE) {
      // A wobble near the turn, not a tide: skip it, and the next peak competes with the last.
      continue;
    } else {
      turns.push({ time, height: h, type });
    }
  }
  return turns;
}

/** The height at a moment, read off the curve. */
export function heightAt(heights: Array<[string, number]>, t: number): number | undefined {
  for (let i = 1; i < heights.length; i++) {
    const t0 = Date.parse(heights[i - 1][0]), t1 = Date.parse(heights[i][0]);
    if (t >= t0 && t <= t1) return heights[i - 1][1] + ((heights[i][1] - heights[i - 1][1]) * (t - t0)) / (t1 - t0);
  }
  return undefined;
}
