import type { Aircraft } from './types';
import { classify } from './notable';

// Small facts worked out from the planes in range, for the radar screen: which one will pass
// closest to home next and where to look for it, where each is heading by its autopilot, the
// wind high up, and a tally of the day.

const NM_KM = 1.852;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export interface LookUp {
  aircraft: Aircraft;
  /** Seconds until it is closest to home (0: it is closest about now). */
  inSec: number;
  /** How far from home it will be then, along the ground. */
  distKm: number;
  /** Where to look then: compass bearing from home, and how high above the horizon. */
  bearingDeg: number;
  elevationDeg: number;
}

/** Planes passing within this of home count as going over; the nearest of the rest otherwise. */
const OVERHEAD_KM = 4;
const HORIZON_SEC = 15 * 60;

/**
 * The plane that will pass closest to home next, from where each one is and its track and speed
 * (a straight line: good for the next few minutes, which is what matters). Planes overhead now
 * or passing within OVERHEAD_KM soonest win; failing that, the closest pass in the next 15 minutes.
 */
export function nextOverhead(aircraft: Aircraft[]): LookUp | null {
  const passes: LookUp[] = [];
  for (const a of aircraft) {
    if (a.altFt === null || a.onGround || a.groundSpeedKt == null || a.trackDeg == null || a.groundSpeedKt < 40) continue;
    const b = (a.bearingDeg * Math.PI) / 180;
    const px = Math.sin(b) * a.distanceNm * NM_KM, py = Math.cos(b) * a.distanceNm * NM_KM; // km east, north
    const t = (a.trackDeg * Math.PI) / 180;
    const sp = (a.groundSpeedKt * NM_KM) / 3600; // km/s
    const vx = Math.sin(t) * sp, vy = Math.cos(t) * sp;
    const tStar = Math.max(0, -(px * vx + py * vy) / (vx * vx + vy * vy));
    if (tStar > HORIZON_SEC) continue;
    const cx = px + vx * tStar, cy = py + vy * tStar;
    const distKm = Math.hypot(cx, cy);
    const altKm = (a.altFt * 0.3048) / 1000;
    passes.push({
      aircraft: a, inSec: tStar, distKm,
      bearingDeg: ((Math.atan2(cx, cy) * 180) / Math.PI + 360) % 360,
      elevationDeg: (Math.atan2(altKm, Math.max(distKm, 0.05)) * 180) / Math.PI,
    });
  }
  const over = passes.filter(p => p.distKm <= OVERHEAD_KM).sort((x, y) => x.inSec - y.inSec);
  if (over.length) return over[0];
  return passes.sort((x, y) => x.distKm - y.distKm)[0] ?? null;
}

/** How high to look, in words a glance can use. */
export function heightWord(elevationDeg: number): string {
  if (elevationDeg >= 70) return 'straight up';
  if (elevationDeg >= 40) return 'high';
  if (elevationDeg >= 20) return 'halfway up';
  return 'low';
}

/** The look-up card's pieces: when ("in 3 min", "now"), how close it passes, where to look, and
 *  whether it's straight overhead (where a compass arrow would mean nothing). */
export function lookUpParts(p: LookUp): { when: string; where: string; pass: string; overhead: boolean } {
  const when = p.inSec < 45 ? 'now' : `in ${Math.round(p.inSec / 60)} min`;
  const overhead = heightWord(p.elevationDeg) === 'straight up';
  const where = overhead ? 'Look straight up' : `Look ${heightWord(p.elevationDeg)} in the ${compassWord(p.bearingDeg)}`;
  const pass = p.distKm <= OVERHEAD_KM ? 'Passes overhead' : `Passes ${p.distKm.toFixed(p.distKm < 10 ? 1 : 0)} km away`;
  return { when, where, pass, overhead };
}

/** The same as one sentence: "BA117 goes over in 3 min: look high in the north-east". */
export function lookUpText(p: LookUp, name: string): string {
  const { when, where } = lookUpParts(p);
  const look = where.charAt(0).toLowerCase() + where.slice(1);
  if (p.distKm <= OVERHEAD_KM) return `${name} ${p.inSec < 45 ? 'is overhead now' : `goes over ${when}`}: ${look}`;
  return `${name} passes ${p.distKm.toFixed(p.distKm < 10 ? 1 : 0)} km away ${when}: ${look}`;
}

/** What the autopilot is set to, when the plane is climbing or descending to it: "climbing to 35,000 ft". */
export function targetText(a: Aircraft): string | null {
  if (a.altFt === null || a.navAltFt == null || a.navAltFt <= 0) return null;
  const diff = a.navAltFt - a.altFt;
  if (Math.abs(diff) < 400) return null;
  const to = `${(Math.round(a.navAltFt / 100) * 100).toLocaleString('en-GB')} ft`;
  return diff > 0 ? `climbing to ${to}` : `descending to ${to}`;
}

/** The same, short, for beside the altitude (whose arrow already says up or down): "to 35,000 ft". */
export const targetShort = (a: Aircraft): string | null => targetText(a)?.replace(/^(climbing|descending) /, '') ?? null;

export interface WindAloft { altFt: number; kmh: number; fromDeg: number; reports: number }

/**
 * The wind high up, from what the highest planes report (each works it out from its own speed
 * through the air and over the ground). Averaged over the planes within 4,000 ft of the highest
 * report, so one odd figure doesn't decide it. Null when no plane above 20,000 ft reports wind.
 */
export function windAloft(aircraft: Aircraft[]): WindAloft | null {
  const reports = aircraft.filter(a => a.altFt !== null && a.altFt >= 20_000 && a.windKt != null && a.windFromDeg != null);
  if (!reports.length) return null;
  const top = Math.max(...reports.map(a => a.altFt!));
  const band = reports.filter(a => a.altFt! >= top - 4000);
  // Average as vectors, so 350° and 10° make north rather than south.
  let x = 0, y = 0;
  for (const a of band) {
    const r = (a.windFromDeg! * Math.PI) / 180;
    x += Math.sin(r) * a.windKt!; y += Math.cos(r) * a.windKt!;
  }
  x /= band.length; y /= band.length;
  const alt = band.reduce((s, a) => s + a.altFt!, 0) / band.length;
  return { altFt: Math.round(alt / 1000) * 1000, kmh: Math.round(Math.hypot(x, y) * NM_KM), fromDeg: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, reports: band.length };
}

export function windText(w: WindAloft): string {
  const jet = w.kmh >= 180 ? 'Jet stream' : 'Wind';
  return `${jet} at ${w.altFt.toLocaleString('en-GB')} ft: ${w.kmh} km/h from the ${compassWord(w.fromDeg)}`;
}

// The day's tally, kept by the display itself (so it counts what this screen has seen today).

export interface Best { name: string; value: number }
export interface Tally {
  day: string; // YYYY-MM-DD in the hub's time zone
  seen: string[]; // hex codes
  highest?: Best; // feet
  fastest?: Best; // km/h over the ground
  oldest?: Best & { type?: string }; // year built
  notable: string[]; // titles of rare aircraft, and "Military" entries, at most a few
  military: string[]; // hex codes
}

export const emptyTally = (day: string): Tally => ({ day, seen: [], notable: [], military: [] });

/** Adds what's in the air now to the day's tally (a new day starts a new one). */
export function addToTally(t: Tally | null, day: string, aircraft: Aircraft[], nameOf: (a: Aircraft) => string): Tally {
  const tally = t && t.day === day ? { ...t, seen: [...t.seen], notable: [...t.notable], military: [...t.military] } : emptyTally(day);
  const seen = new Set(tally.seen);
  for (const a of aircraft) {
    if (a.onGround || a.altFt === null) continue;
    seen.add(a.hex);
    const name = nameOf(a);
    if (a.altFt > (tally.highest?.value ?? -1)) tally.highest = { name, value: a.altFt };
    const kmh = a.groundSpeedKt != null ? Math.round(a.groundSpeedKt * NM_KM) : null;
    // Over the ground, so a strong tailwind helps; anything over 1,300 km/h is a bad report.
    if (kmh !== null && kmh < 1300 && kmh > (tally.fastest?.value ?? -1)) tally.fastest = { name, value: kmh };
    if (a.year && a.year < (tally.oldest?.value ?? 9999)) tally.oldest = { name, value: a.year, type: a.type ?? undefined };
    const n = classify(a);
    if (n?.kind === 'rare' && !tally.notable.includes(n.title) && tally.notable.length < 6) tally.notable.push(n.title);
    if (a.military && !tally.military.includes(a.hex)) tally.military.push(a.hex);
  }
  tally.seen = [...seen];
  return tally;
}

/** Two short lines for the radar: the count and what stood out, then the records. */
export function tallyLines(t: Tally): [string, string] {
  const first = [`${t.seen.length.toLocaleString('en-GB')} planes so far`,
    t.military.length ? `${t.military.length} military` : null,
    t.notable.length ? `rare: ${t.notable.slice(0, 2).join(', ')}` : null].filter(Boolean).join(' · ');
  const second = tallyRecords(t).map(([what, who]) => `${what} (${who})`).join(' · ');
  return [first, second || ' '];
}

/** The day's records, each with the plane that set it: [label and value, plane]. */
export function tallyRecords(t: Tally): Array<[string, string]> {
  const recs: Array<[string, string] | null> = [
    t.highest ? [`highest ${t.highest.value.toLocaleString('en-GB')} ft`, t.highest.name] : null,
    t.fastest ? [`fastest ${t.fastest.value.toLocaleString('en-GB')} km/h`, t.fastest.name] : null,
    t.oldest ? [`oldest ${t.oldest.value}${t.oldest.type ? ` ${t.oldest.type}` : ''}`, t.oldest.name] : null,
  ];
  return recs.filter((r): r is [string, string] => !!r);
}
