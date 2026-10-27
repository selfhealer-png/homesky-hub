import type { Aircraft } from './types';
import { angleBetween } from './arrivals';

// Which aircraft are worth pointing out, and how to find them in the sky. Shared by the Worker
// (the Overhead board puts a rare aircraft first) and the display (alerts, the radar, the
// plane card).
//
// Emergencies and rare types (giants, warbirds, the odd spy plane) are "highly notable": worth
// interrupting whatever's on screen. Military and special-operator aircraft (police, air
// ambulance, government) are common near bases and cities, so they only alert when chosen.

/** Alerts on the display: none, rare aircraft and emergencies, or also military and special. */
export type AlertLevel = 'off' | 'rare' | 'all';
export const ALERT_LEVELS: AlertLevel[] = ['off', 'rare', 'all'];
export const DEFAULT_ALERTS: AlertLevel = 'rare';

export type NotableKind = 'emergency' | 'rare' | 'military' | 'special';

export interface Notable {
  kind: NotableKind;
  /** A few words: "Airbus Beluga XL", "Squawk 7700: emergency", "Military". */
  title: string;
}

/** ICAO type designators rare enough to come and look at, with their names and articles. */
export const RARE_TYPES: Record<string, [name: string, article: string]> = {
  A3ST: ['Airbus Beluga', 'Airbus Beluga'],
  A337: ['Airbus Beluga XL', 'Airbus BelugaXL'],
  BLCF: ['Boeing Dreamlifter', 'Boeing Dreamlifter'],
  A124: ['Antonov An-124 Ruslan', 'Antonov An-124 Ruslan'],
  A225: ['Antonov An-225 Mriya', 'Antonov An-225 Mriya'],
  AN22: ['Antonov An-22', 'Antonov An-22'],
  C5M: ['Lockheed C-5 Galaxy', 'Lockheed C-5 Galaxy'],
  B52: ['Boeing B-52 Stratofortress', 'Boeing B-52 Stratofortress'],
  B1: ['Rockwell B-1 Lancer', 'Rockwell B-1 Lancer'],
  B2: ['Northrop B-2 Spirit', 'Northrop B-2 Spirit'],
  U2: ['Lockheed U-2', 'Lockheed U-2'],
  V22: ['Bell Boeing V-22 Osprey', 'Bell Boeing V-22 Osprey'],
  E3TF: ['Boeing E-3 Sentry', 'Boeing E-3 Sentry'],
  E3CF: ['Boeing E-3 Sentry', 'Boeing E-3 Sentry'],
  E6: ['Boeing E-6 Mercury', 'Boeing E-6 Mercury'],
  E4: ['Boeing E-4 Nightwatch', 'Boeing E-4'],
  VC25: ['Boeing VC-25', 'Boeing VC-25'],
  TU95: ['Tupolev Tu-95', 'Tupolev Tu-95'],
  CONC: ['Concorde', 'Concorde'],
  SPIT: ['Supermarine Spitfire', 'Supermarine Spitfire'],
  HURI: ['Hawker Hurricane', 'Hawker Hurricane'],
  LANC: ['Avro Lancaster', 'Avro Lancaster'],
  B17: ['Boeing B-17 Flying Fortress', 'Boeing B-17 Flying Fortress'],
  B29: ['Boeing B-29 Superfortress', 'Boeing B-29 Superfortress'],
  P51: ['North American P-51 Mustang', 'North American P-51 Mustang'],
  DC3: ['Douglas DC-3', 'Douglas DC-3'],
  CONI: ['Lockheed Constellation', 'Lockheed Constellation'],
  JU52: ['Junkers Ju 52', 'Junkers Ju 52'],
  CAT: ['Consolidated PBY Catalina', 'Consolidated PBY Catalina'],
  SHIP: ['Airship', 'Airship'],
};

const SQUAWKS: Record<string, string> = { '7700': 'emergency', '7600': 'radio failure', '7500': 'unlawful interference' };

export function classify(a: Aircraft): Notable | null {
  if (a.emergency) {
    const meaning = a.squawk ? SQUAWKS[a.squawk] : undefined;
    return { kind: 'emergency', title: meaning ? `Squawk ${a.squawk}: ${meaning}` : 'Emergency declared' };
  }
  const rare = a.type ? RARE_TYPES[a.type] : undefined;
  if (rare) return { kind: 'rare', title: rare[0] };
  if (a.military) return { kind: 'military', title: 'Military' };
  if (a.interesting) return { kind: 'special', title: 'Special operator' };
  return null;
}

/** Whether this aircraft should interrupt the display, at the chosen alert level. */
export function shouldAlert(n: Notable | null, level: AlertLevel): boolean {
  if (!n || level === 'off') return false;
  return n.kind === 'emergency' || n.kind === 'rare' || level === 'all';
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

/** With the usual allowance for refraction, the horizon drops away over an earth this big. */
const EFFECTIVE_EARTH_M = 8_500_000;

/** Degrees above the horizon, seen from home (taken to be near sea level). */
export function elevationDeg(a: Aircraft): number | null {
  if (a.altFt === null) return null;
  const d = a.distanceNm * 1852;
  const h = a.altFt * 0.3048 - (d * d) / (2 * EFFECTIVE_EARTH_M);
  return (Math.atan2(h, d) * 180) / Math.PI;
}

/** Flying towards home, give or take 50°. */
export const approaching = (a: Aircraft) => a.trackDeg !== null && a.distanceNm > 1 && angleBetween(a.trackDeg, (a.bearingDeg + 180) % 360) < 50;

/** Where to look: "Overhead", "Look north-west, 24° up", or "Low to the north-west" (below 8°). */
export function whereToLook(a: Aircraft): string | null {
  const elev = elevationDeg(a);
  if (elev === null || elev < 0) return null;
  if (elev >= 75 || a.distanceNm < 0.5) return 'Overhead';
  if (elev < 8) return `Low to the ${compassWord(a.bearingDeg)}`;
  return `Look ${compassWord(a.bearingDeg)}, ${Math.round(elev)}° up`;
}

/** The feed's type name in ordinary case: "BOEING 737-800" → "Boeing 737-800". Model codes
 *  (AW-139, EC-135) and short makers (BAE) keep their capitals. */
export function typeName(desc: string | null | undefined): string | null {
  if (!desc?.trim()) return null;
  return desc.trim().replace(/\s+/g, ' ').split(' ').map(w => {
    if (!/^[A-Z]{4,}$/.test(w)) return w;
    if (/^MC[A-Z]/.test(w)) return `Mc${w[2]}${w.slice(3).toLowerCase()}`;
    return w[0] + w.slice(1).toLowerCase();
  }).join(' ');
}

/** The Wikipedia article for the common airliner families, by ICAO type designator: searching
 *  for a registry name like "Boeing 737NG 8AS/W" finds the wrong article as often as the right. */
const FAMILIES: Array<[RegExp, string]> = [
  [/^B3[789X]M$/, 'Boeing 737 MAX'],
  [/^B73[6-9]$/, 'Boeing 737 Next Generation'],
  [/^B73[345]$/, 'Boeing 737 Classic'],
  [/^B74/, 'Boeing 747'], [/^B75/, 'Boeing 757'], [/^B76/, 'Boeing 767'], [/^B77/, 'Boeing 777'], [/^B78/, 'Boeing 787 Dreamliner'],
  [/^A(19|20|21)N$/, 'Airbus A320neo family'],
  [/^A3(18|19|20|21)$/, 'Airbus A320 family'],
  [/^(BCS[13]|A22[0-3])$/, 'Airbus A220'],
  [/^A33[89]$/, 'Airbus A330neo'], [/^A33/, 'Airbus A330'], [/^A34/, 'Airbus A340'], [/^A35/, 'Airbus A350'], [/^A38/, 'Airbus A380'],
  [/^E29[05]$|^E2[79]\d$/, 'Embraer E-Jet E2 family'],
  [/^E(17|19)\d$|^E7[05]$/, 'Embraer E-Jet family'],
  [/^AT4/, 'ATR 42'], [/^AT7/, 'ATR 72'],
  [/^DH8/, 'De Havilland Canada Dash 8'],
  [/^CRJ[79X]$/, 'Bombardier CRJ700 series'], [/^CRJ[12]$/, 'Bombardier CRJ100/200'],
];

/** The article to show for an aircraft's type, when it's known without searching. */
export function typeArticleTitle(type: string | null): string | null {
  if (!type) return null;
  return RARE_TYPES[type]?.[1] ?? FAMILIES.find(([re]) => re.test(type))?.[1] ?? null;
}

/** Whether a search result is about the type named: it shares the model number ("737" in
 *  "Boeing 737NG 8AS"), or with no number, a word of the name; and it isn't a list. */
export function aboutType(title: string, name: string): boolean {
  if (/^list of/i.test(title)) return false;
  const numbers = (t: string): string[] => t.match(/\d{2,}/g) ?? [];
  const wantedNumbers = numbers(name);
  if (wantedNumbers.length) return numbers(title).some(n => wantedNumbers.includes(n));
  const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4);
  const wanted = new Set(words(name));
  return words(title).some(w => wanted.has(w));
}
