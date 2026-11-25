import { addToTally, type Tally } from '../shared/skyFacts';
import type { Aircraft } from '../shared/types';

// The day's tally of planes for the radar's "Today" lines, kept on this display. Fed by every
// aircraft answer the page gets (the radar's, and the alerts check that runs on every screen),
// so it counts the whole day the display is on, not only while the radar is showing.

const KEY = 'hub.skyToday';
let memo: Tally | null = null;

const dayIn = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nameOf = (a: Aircraft) => a.callsign ?? a.registration ?? a.hex.toUpperCase();

function load(): Tally | null {
  if (memo) return memo;
  try { memo = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Tally | null; } catch { memo = null; }
  return memo;
}

/** Adds an answer's planes to today's tally. */
export function countSky(aircraft: Aircraft[], timeZone: string) {
  memo = addToTally(load(), dayIn(timeZone), aircraft, nameOf);
  try { localStorage.setItem(KEY, JSON.stringify(memo)); } catch { /* private mode: kept until reload */ }
}

/** Today's tally, or null before the first plane of the day. */
export function skyToday(timeZone: string): Tally | null {
  const t = load();
  return t && t.day === dayIn(timeZone) ? t : null;
}
