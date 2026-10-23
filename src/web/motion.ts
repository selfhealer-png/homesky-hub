import type { MotionLevel } from '../shared/settings';

// How much the display is allowed to move, chosen in /setup:
//   full    every animation (flipping letters, drifting photos, the radar ping)
//   gentle  changes fade softly instead of flipping or drifting
//   still   nothing animates; only live data (aircraft positions) moves
// A device set to reduce motion never gets more than 'gentle'.

let level: MotionLevel = 'full';

export function setMotionLevel(chosen: MotionLevel) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  level = reduce && chosen === 'full' ? 'gentle' : chosen;
  document.documentElement.dataset.motion = level;
}

export const motionLevel = () => level;
