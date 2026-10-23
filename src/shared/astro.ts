// Sun and moon for the Tonight screen, worked out locally: no network needed. Low-precision
// formulas (accurate to a minute or so, which is plenty for "moonrise 21:04"), after the
// standard approximations in Meeus' Astronomical Algorithms.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const daysSinceJ2000 = (t: number) => t / DAY_MS - 0.5 + J1970 - J2000;

const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;
const altitude = (H: number, φ: number, dec: number) => Math.asin(Math.sin(φ) * Math.sin(dec) + Math.cos(φ) * Math.cos(dec) * Math.cos(H));

/** The sun's ecliptic longitude (radians) for a number of days since J2000. */
export function sunLongitude(d: number): number {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}

function sunCoords(d: number) {
  const L = sunLongitude(d);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/** Degrees above the horizon. */
export function sunAltitude(t: number, lat: number, lon: number): number {
  const d = daysSinceJ2000(t);
  const c = sunCoords(d);
  return altitude(siderealTime(d, RAD * -lon) - c.ra, RAD * lat, c.dec) / RAD;
}

export function moonAltitude(t: number, lat: number, lon: number): number {
  const d = daysSinceJ2000(t);
  const c = moonCoords(d);
  const h = altitude(siderealTime(d, RAD * -lon) - c.ra, RAD * lat, c.dec);
  // Parallax: the moon is close enough to sit visibly lower than its geocentric position.
  return (h - Math.asin((6378.14 / c.dist) * Math.cos(h))) / RAD;
}

/** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter; fraction is how much is lit. */
export function moonPhase(t: number): { phase: number; fraction: number } {
  const d = daysSinceJ2000(t);
  const s = sunCoords(d), m = moonCoords(d);
  const sunDist = 149598000;
  const φ = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sunDist * Math.sin(φ), m.dist - sunDist * Math.cos(φ));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI };
}

export function phaseName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'New moon';
  if (phase < 0.22) return 'Waxing crescent';
  if (phase < 0.28) return 'First quarter';
  if (phase < 0.47) return 'Waxing gibbous';
  if (phase < 0.53) return 'Full moon';
  if (phase < 0.72) return 'Waning gibbous';
  if (phase < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

/** Times between from and to when fn crosses threshold, found by stepping then halving. */
export function crossings(fn: (t: number) => number, from: number, to: number, threshold: number, stepMs = 5 * 60_000) {
  const out: Array<{ t: number; rising: boolean }> = [];
  let a = from, fa = fn(a) - threshold;
  for (let b = from + stepMs; b <= to; b += stepMs) {
    const fb = fn(b) - threshold;
    if (fa < 0 !== fb < 0) {
      let lo = a, hi = b;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if ((fn(mid) - threshold < 0) === fa < 0) lo = mid; else hi = mid;
      }
      out.push({ t: Math.round((lo + hi) / 2), rising: fb > fa });
    }
    a = b; fa = fb;
  }
  return out;
}

// The sun's centre is this far below the horizon at each moment.
export const SUNSET = -0.833; // its top edge touching the horizon, with refraction
export const DARK = -12; // nautical dusk: most stars out, the sky no longer blue
const MOON_HORIZON = 0.133;

export interface Night {
  /** When tonight's sunset was or will be, and the sunrise that ends the night. */
  sunset?: number;
  sunrise?: number;
  /** When the sky is properly dark, and when it stops being. Absent on summer nights that never get dark. */
  dark?: number;
  darkEnds?: number;
  /** The sun never sets (polar summer) or never rises (polar winter). */
  allDay?: boolean;
  allNight?: boolean;
}

/** The night that is happening now, or the coming one if it's daytime. */
export function tonight(now: number, lat: number, lon: number): Night {
  const sun = (t: number) => sunAltitude(t, lat, lon);
  const span = 26 * 3_600_000;
  // If it's already night, the night began at the last sunset.
  const start = sun(now) < SUNSET ? (crossings(sun, now - span, now, SUNSET).filter(c => !c.rising).pop()?.t ?? now - span) : now;
  const sets = crossings(sun, start - 60_000, start + span, SUNSET);
  const sunset = sets.find(c => !c.rising)?.t;
  if (sunset === undefined) return sun(now) > SUNSET ? { allDay: true } : { allNight: true };
  const sunrise = sets.find(c => c.rising && c.t > sunset)?.t;
  const dusk = crossings(sun, sunset, sunrise ?? sunset + span, DARK);
  return { sunset, sunrise, dark: dusk.find(c => !c.rising)?.t, darkEnds: dusk.find(c => c.rising)?.t };
}

/** The moon's next rise and set after a time (within about a day). */
export function moonTimes(from: number, lat: number, lon: number): { rise?: number; set?: number } {
  const c = crossings(t => moonAltitude(t, lat, lon), from, from + 26 * 3_600_000, MOON_HORIZON, 10 * 60_000);
  return { rise: c.find(x => x.rising)?.t, set: c.find(x => !x.rising)?.t };
}
