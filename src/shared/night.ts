import { sunAltitude, SUNSET } from './astro';
import type { NightSettings } from './settings';

// When the display is in its night look, worked out on the display itself every minute:
//   day      as designed
//   evening  from sunset to sunrise: nothing on screen is brighter than the dark screens
//            (the cream board goes dark, the street map is inverted, pictures are dimmed)
//   quiet    the quiet hours set in /setup: the evening look, and the whole display dims
//            and shows only the clock, Home and Tonight
// Quiet hours follow the clock, not the sun, because people go to bed at the same time all
// year; the evening look follows the sun, because that's when a bright screen starts to glare.

export type NightPhase = 'day' | 'evening' | 'quiet';

/** Minutes since midnight in a timezone. */
export function minutesIn(timeZone: string, t: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(t).map(x => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether a time of day falls in the quiet hours; they may run past midnight. Equal ends mean none. */
export function inQuietHours(minutes: number, from: string, to: string): boolean {
  const a = toMinutes(from), b = toMinutes(to);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

export function nightPhase(t: number, lat: number, lon: number, timeZone: string, night: NightSettings): NightPhase {
  if (night.mode === 'off') return 'day';
  if (night.mode === 'quiet' && inQuietHours(minutesIn(timeZone, t), night.from, night.to)) return 'quiet';
  return sunAltitude(t, lat, lon) < SUNSET ? 'evening' : 'day';
}
