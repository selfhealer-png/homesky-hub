import { minutesToGo } from '../../shared/arrivals';
import { classify, typeName } from '../../shared/notable';
import type { RadarMap } from '../../shared/settings';
import type { Aircraft, AircraftResponse, HubConfig, PlaceName, RouteSummary } from '../../shared/types';
import { getJson, setApiImage } from '../api';
import { tileDisc, TILE_SOURCES } from '../mapTiles';
import { airportsAround, type NearbyAirport } from '../nearbyAirports';
import { placesAround } from '../placeNames';
import { nextPlace, skyHome, skyQuery, type SkyHome } from '../location';
import { motionLevel } from '../motion';
import { ageLabel, recall, Refresher, remember, watchAge, type Outcome } from '../skyCache';
import { countSky, skyToday } from '../skyToday';
import { lookUpParts, nextOverhead, tallyLines, tallyRecords, targetShort, windAloft, windText, type LookUp } from '../../shared/skyFacts';
import { h, type Screen } from '../screen';

// An ambient radar for a room: calm at a glance, detailed on a closer look.
// Only the few nearest aircraft are labelled, with a faint line to where they're going;
// everything else is a small silhouette of its kind (airliner, light aircraft, helicopter…)
// coloured by altitude, and planes on the ground are fainter still. The one animation that
// carries meaning is the ping that ripples out from home each time fresh positions arrive.

const FEATURED = 5;

/** Aircraft on the ground; category C is airport vehicles and fixed obstacles, which aren't. */
const onGround = (data: AircraftResponse) => data.aircraft.filter(a => a.onGround && !a.category?.startsWith('C'));
/** How much of each plane's path is drawn behind it. */
const TRAIL_SECONDS = 10 * 60;
const FRAME_MS = 1000 / 30; // 30 fps is plenty for planes and kinder to an always-on tablet

// Altitude colour ramp: warm near the ground, cool at cruise. Shared with the legend.
const ALT_STOPS: Array<[number, [number, number, number]]> = [
  [0, [251, 191, 36]],      // amber
  [12000, [251, 113, 133]], // rose
  [25000, [192, 132, 252]], // violet
  [38000, [125, 211, 252]], // sky
];

export function altitudeColor(ft: number | null, alpha = 1): string {
  const v = Math.max(0, ft ?? 0);
  let i = 0;
  while (i < ALT_STOPS.length - 2 && v > ALT_STOPS[i + 1][0]) i++;
  const [a0, c0] = ALT_STOPS[i];
  const [a1, c1] = ALT_STOPS[i + 1];
  const t = Math.min(1, Math.max(0, (v - a0) / (a1 - a0)));
  const c = c0.map((x, k) => Math.round(x + (c1[k] - x) * t));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

// Feet for height and kilometres for distance on every screen; the range is set in nautical
// miles (as ADS-B reports it) but never shown in them.
const NM_KM = 1.852;
const fmtAlt = (a: Aircraft) => (a.altFt == null ? '' : `${a.altFt.toLocaleString('en-GB')} ft`);
const name = (a: Aircraft) => a.callsign ?? a.registration ?? a.hex.toUpperCase();
/** Light aircraft fly under their registration: G-VOAR's callsign is GVOAR, so don't say it twice. */
const regRepeats = (a: Aircraft) => !!a.registration && a.callsign?.trim().toUpperCase() === a.registration.replace(/-/g, '').toUpperCase();

// Aircraft silhouettes pointing up (north), about 16 px nose to tail at scale 1, chosen by the
// ADS-B emitter category each aircraft sends.
const AIRLINER = new Path2D('M0 -8 L1.3 -5.6 L1.3 -2.2 L7.5 1.6 L7.5 3 L1.3 1.2 L1 5.3 L3 6.8 L3 7.8 L0 7 L-3 7.8 L-3 6.8 L-1 5.3 L-1.3 1.2 L-7.5 3 L-7.5 1.6 L-1.3 -2.2 L-1.3 -5.6 Z');
/** Straight wings and a propeller nose: a light aircraft. */
const LIGHT = new Path2D('M0 -7.5 L1 -6.5 L1 -3.2 L8 -3.2 L8 -1.2 L1 -1.2 L0.7 4.8 L3.4 5.3 L3.4 6.9 L0 6.5 L-3.4 6.9 L-3.4 5.3 L-0.7 4.8 L-1 -1.2 L-8 -1.2 L-8 -3.2 L-1 -3.2 L-1 -6.5 Z');
const GLIDER = new Path2D('M0 -6.5 L0.7 -5.2 L0.7 -2.6 L11 -2.1 L11 -1.2 L0.7 -1 L0.5 5.5 L2.8 6 L2.8 7 L0 6.6 L-2.8 7 L-2.8 6 L-0.5 5.5 L-0.7 -1 L-11 -1.2 L-11 -2.1 L-0.7 -2.6 L-0.7 -5.2 Z');
/** A delta: fast jets. */
const FAST = new Path2D('M0 -8.5 L1.2 -4 L6.8 4.8 L6.8 6.4 L1.6 5.4 L2.6 7.6 L-2.6 7.6 L-1.6 5.4 L-6.8 6.4 L-6.8 4.8 L-1.2 -4 Z');
const HELI = new Path2D();
HELI.ellipse(0, -1, 2.6, 4.2, 0, 0, Math.PI * 2);
HELI.rect(-0.7, 2.5, 1.4, 6);
HELI.rect(-2.6, 7.6, 5.2, 1.2);
const ROTOR = new Path2D();
ROTOR.arc(0, -1, 7.5, 0, Math.PI * 2);
const BALLOON = new Path2D();
BALLOON.arc(0, -1.5, 5.5, 0, Math.PI * 2);
BALLOON.rect(-1.6, 5, 3.2, 2.6);
const DRONE = new Path2D('M-5.2 -4.2 L-4.2 -5.2 L5.2 4.2 L4.2 5.2 Z M4.2 -5.2 L5.2 -4.2 L-4.2 5.2 L-5.2 4.2 Z');
for (const [x, y] of [[-4.7, -4.7], [4.7, -4.7], [-4.7, 4.7], [4.7, 4.7]]) { DRONE.moveTo(x + 2.6, y); DRONE.arc(x, y, 2.6, 0, Math.PI * 2); }

interface Icon { path: Path2D; scale: number; rotor?: boolean; upright?: boolean }

function iconFor(a: Aircraft): Icon {
  switch (a.category) {
    case 'A1': case 'B4': return { path: LIGHT, scale: 0.9 };
    case 'A2': return { path: AIRLINER, scale: 0.85 };
    case 'A4': return { path: AIRLINER, scale: 1.15 };
    case 'A5': return { path: AIRLINER, scale: 1.3 };
    case 'A6': return { path: FAST, scale: 1 };
    case 'A7': return { path: HELI, scale: 1, rotor: true };
    case 'B1': return { path: GLIDER, scale: 1 };
    case 'B2': return { path: BALLOON, scale: 0.9, upright: true };
    case 'B6': return { path: DRONE, scale: 0.85 };
    default: return { path: AIRLINER, scale: 1 };
  }
}

/** One aircraft's silhouette at (x, y), turned to its track; `edge` outlines it over a map. */
function drawIcon(ctx: CanvasRenderingContext2D, a: Aircraft, x: number, y: number, size: number, fill: string, edge: string | null) {
  const icon = iconFor(a);
  const s = size * icon.scale;
  ctx.save();
  ctx.translate(x, y);
  if (!icon.upright) ctx.rotate(((a.trackDeg ?? 0) * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.fillStyle = fill;
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 2 / s; ctx.lineJoin = 'round'; ctx.stroke(icon.path); }
  ctx.fill(icon.path);
  if (icon.rotor) { ctx.strokeStyle = fill; ctx.lineWidth = 1.2 / s; ctx.stroke(ROTOR); }
  ctx.restore();
}

interface Label { x: number; y: number; w: number; h: number }

interface State {
  home: SkyHome;
  data: AircraftResponse | null;
  receivedAt: number;
  trails: Map<string, Array<[number, number, number]>>; // hex -> [eastNm, northNm, epoch seconds], oldest first
  placement: Map<string, number>; // hex -> chosen label slot, kept stable between frames
  pingAt: number;
  error: string | null;
  /** What the map layer was last built for; it's rebuilt when this changes. */
  mapKey: string;
  /** Towns and cities around home, biggest first, for labelling. */
  places: PlaceName[];
  /** Airports with scheduled flights round home, the big ones first. */
  airports: NearbyAirport[];
  /** The next answer should bring the trails the shared fetcher remembers (just opened, or moved). */
  wantTrails: boolean;
  /** The plane the look-up card is about, ringed on the radar. */
  lookHex?: string;
  /** Its predicted pass, from the positions measured at `dataAt` (epoch ms). */
  look?: { pass: LookUp; dataAt: number };
  /** The soft wave from home when the look-up plane is about to go over: which plane, and when it started. */
  wave?: { hex: string; at: number };
  /** When each plane was first seen (performance.now()), so newcomers fade in. Planes already
   *  there when the screen opened count as long seen. */
  firstSeen: Map<string, number>;
}

let refresher: Refresher | undefined;
let stopAge: (() => void) | undefined;
let frame: number | undefined;
let retarget: (() => void) | undefined;
let currentConfig: HubConfig | undefined;
let current: State | undefined;
let canvasEl: HTMLCanvasElement | undefined;
/** Where each plane was last drawn, in canvas pixels, for finding the one under a tap. */
let drawn: Array<{ a: Aircraft; x: number; y: number }> = [];

// What's under the radar is chosen in /setup (Sky › Radar background).
const mapChoice = (config: HubConfig): RadarMap => config.radarMap ?? 'plain';

/** Over a map, everything drawn needs a dark edge to stand out from busy, bright ground. */
let onMap = false;

function offsetNm(home: SkyHome, lat: number, lon: number): [number, number] {
  return [(lon - home.lon) * 60 * Math.cos((home.lat * Math.PI) / 180), (lat - home.lat) * 60];
}

// Dead-reckon forward between polls so movement is continuous.
function projected(a: Aircraft, home: SkyHome, seconds: number): [number, number] {
  const [e, n] = offsetNm(home, a.lat, a.lon);
  if (a.groundSpeedKt == null || a.trackDeg == null) return [e, n];
  // Keep moving them for up to two minutes, so a missed update or two doesn't freeze or empty the radar.
  const d = (a.groundSpeedKt * Math.min(seconds, 120)) / 3600;
  const t = (a.trackDeg * Math.PI) / 180;
  return [e + Math.sin(t) * d, n + Math.cos(t) * d];
}

const isSmall = () => window.matchMedia('(max-height: 520px), (max-width: 520px)').matches;
/** Portrait: the list sits under the radar, so its height decides the radar's size. */
const isPortrait = () => window.matchMedia('(orientation: portrait)').matches;
/** How many planes get a label and a row in the list: fewer on a phone, where space is short;
 *  three rows of two under the radar in portrait; and in landscape as many as fit beside it
 *  with the look-up, wind and today lines. */
const listed = () => (isSmall() ? 3 : isPortrait() ? 6 : FEATURED);
/** Routes are looked up for this many of the nearest planes (the most any layout lists). */
const ROUTES = 6;

function featured(data: AircraftResponse): Set<string> {
  const airborne = data.aircraft.filter(a => a.altFt !== null);
  // Emergencies and rare aircraft are always labelled, however far out.
  const special = airborne.filter(a => a.emergency || classify(a)?.kind === 'rare');
  return new Set([...special, ...airborne.slice(0, listed())].map(a => a.hex));
}

/** The look-up card's plane is ringed in the card's sky blue. */
const LOOK_RING = '#7DD3FC';

/** Rare aircraft get an amber ring; military and special operators a fainter, dashed one. */
const RING: Partial<Record<string, string>> = { rare: '#FBBF24', military: 'rgba(226, 232, 240, 0.7)', special: 'rgba(226, 232, 240, 0.7)' };

/** Range rings every so many kilometres, for a radius in nautical miles. */
const ringStepKm = (radiusNm: number) => { const km = radiusNm * NM_KM; return km <= 60 ? 10 : km <= 120 ? 20 : 50; };

/** Where the range rings' distance labels go: along the 135° bearing, where traffic is rarely drawn. */
function ringLabels(cx: number, cy: number, r: number, radiusNm: number): Array<{ km: number; x: number; y: number }> {
  const radiusKm = radiusNm * NM_KM;
  const step = ringStepKm(radiusNm);
  const out = [];
  const a = (135 * Math.PI) / 180;
  for (let km = step; km < radiusKm; km += step) {
    if (km % (step * 2) !== 0 && radiusKm / step > 4) continue;
    const rr = (km / radiusKm) * r;
    out.push({ km, x: cx + Math.sin(a) * rr, y: cy - Math.cos(a) * rr });
  }
  return out;
}

function drawScope(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, radiusNm: number) {
  // The disc: barely lighter than the page, so it reads as an instrument, not a sticker.
  // Over a map it becomes a soft dark wash instead, so the planes stay the brightest thing.
  const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  disc.addColorStop(0, onMap ? 'rgba(15, 23, 42, 0.18)' : 'rgba(30, 41, 59, 0.55)');
  disc.addColorStop(1, onMap ? 'rgba(15, 23, 42, 0.5)' : 'rgba(30, 41, 59, 0.15)');
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  // Range rings: fine and dashed, with labels set along the 135° bearing where traffic is rarely drawn over them.
  const radiusKm = radiusNm * NM_KM;
  const step = ringStepKm(radiusNm);
  ctx.save();
  ctx.setLineDash([2, 6]);
  ctx.strokeStyle = onMap ? 'rgba(241, 245, 249, 0.5)' : 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = onMap ? 1.2 : 1;
  ctx.font = '600 12px -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = '#94A3B8'; // 6.3:1 on the disc
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let km = step; km < radiusKm; km += step) {
    ctx.beginPath(); ctx.arc(cx, cy, (km / radiusKm) * r, 0, Math.PI * 2); ctx.stroke();
  }
  // The innermost label carries the unit; the rest are just numbers.
  ringLabels(cx, cy, r, radiusNm).forEach(({ km, x: lx, y: ly }, i) => {
    const text = i === 0 ? `${km} km` : `${km}`;
    if (onMap) {
      const w = Math.ceil(ctx.measureText(text).width) + 10;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.beginPath(); ctx.roundRect(lx - w / 2, ly - 9, w, 18, 5); ctx.fill();
      ctx.fillStyle = '#E2E8F0';
    }
    ctx.fillText(text, lx, ly);
    ctx.fillStyle = '#94A3B8';
  });
  ctx.restore();

  // Bezel: a hairline edge with compass ticks every 5°, longer every 30°.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const len = deg % 30 === 0 ? 9 : 4;
    ctx.strokeStyle = deg % 30 === 0 ? 'rgba(148, 163, 184, 0.55)' : 'rgba(148, 163, 184, 0.25)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.lineTo(cx + Math.sin(a) * (r - len), cy - Math.cos(a) * (r - len));
    ctx.stroke();
  }
  ctx.font = '700 13px Gabarito, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
    const a = (deg * Math.PI) / 180;
    ctx.fillStyle = label === 'N' ? '#F1F5F9' : 'rgba(148, 163, 184, 0.8)';
    ctx.fillText(label, cx + Math.sin(a) * (r + 14), cy - Math.cos(a) * (r + 14));
  }
}

function drawHome(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pingAge: number) {
  // The ping: one soft ring per data refresh, easing out over 2.4 s. Full motion only.
  if (pingAge < 2400 && motionLevel() === 'full') {
    const t = pingAge / 2400;
    const ease = 1 - Math.pow(1 - t, 3);
    ctx.strokeStyle = `rgba(241, 245, 249, ${0.28 * (1 - t)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 6 + ease * r * 0.5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(241, 245, 249, 0.14)';
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#F1F5F9';
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
}

const PLACE_FONT: Record<PlaceName['kind'], string> = {
  city: '700 14px -apple-system, "Segoe UI", sans-serif',
  town: '600 12.5px -apple-system, "Segoe UI", sans-serif',
  village: '500 11.5px -apple-system, "Segoe UI", sans-serif',
};

/**
 * Town names: the biggest places first, then the villages nearest home, each only if it fits
 * without touching another. Returns the boxes used, so aircraft labels can avoid them.
 */
function drawPlaces(ctx: CanvasRenderingContext2D, state: State, cx: number, cy: number, r: number, scale: number, radiusNm: number, reserved: Label[]): Label[] {
  if (!state.places.length) return [];
  const max = isSmall() ? 5 : 12;
  const dist = (p: PlaceName) => Math.hypot(...offsetNm(state.home, p.lat, p.lon));
  const villages = state.places.filter(p => p.kind === 'village' && dist(p) < radiusNm * 0.25).sort((a, b) => dist(a) - dist(b)).slice(0, 3);
  const candidates = [...state.places.filter(p => p.kind !== 'village'), ...villages];
  const sat = onMap;
  const boxes: Label[] = [];
  // Home and the ring distances stay clear.
  const taken: Label[] = [...reserved, { x: cx - 14, y: cy - 14, w: 28, h: 28 }, ...ringLabels(cx, cy, r, radiusNm).map(l => ({ x: l.x - 13, y: l.y - 10, w: 26, h: 20 }))];
  const clear = (l: Label) =>
    !taken.some(o => l.x < o.x + o.w && l.x + l.w > o.x && l.y < o.y + o.h && l.y + l.h > o.y) &&
    [[l.x, l.y], [l.x + l.w, l.y], [l.x, l.y + l.h], [l.x + l.w, l.y + l.h]].every(([x, y]) => Math.hypot(x - cx, y - cy) < r - 6);

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const p of candidates) {
    if (boxes.length >= max) break;
    const [e, n] = offsetNm(state.home, p.lat, p.lon);
    const x = cx + e * scale, y = cy - n * scale;
    if (Math.hypot(x - cx, y - cy) > r - 10) continue;
    ctx.font = PLACE_FONT[p.kind];
    const w = ctx.measureText(p.name).width;
    const right = { x: x + 6, y: y - 9, w, h: 18 }, left = { x: x - 6 - w, y: y - 9, w, h: 18 };
    const box = clear(right) ? right : clear(left) ? left : null;
    if (!box) continue;
    taken.push(box);
    boxes.push(box);
    // A soft dark halo keeps names legible over fields, sea and town alike.
    ctx.fillStyle = sat ? 'rgba(241, 245, 249, 0.9)' : 'rgba(148, 163, 184, 0.75)';
    ctx.beginPath(); ctx.arc(x, y, p.kind === 'city' ? 3 : 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
    if (sat) {
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.8)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(p.name, box.x, y);
    }
    ctx.fillStyle = sat ? '#F8FAFC' : p.kind === 'village' ? 'rgba(148, 163, 184, 0.7)' : 'rgba(203, 213, 225, 0.85)';
    ctx.fillText(p.name, box.x, y);
  }
  ctx.restore();
  return boxes;
}

const overlaps = (l: Label, taken: Label[]) => taken.some(o => l.x < o.x + o.w && l.x + l.w > o.x && l.y < o.y + o.h && l.y + l.h > o.y);

/** Airports round home: a small ring and the code, bigger for the big ones. Returns the boxes used. */
function drawAirports(ctx: CanvasRenderingContext2D, state: State, cx: number, cy: number, r: number, scale: number): Label[] {
  const boxes: Label[] = [];
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  for (const ap of state.airports) {
    if (boxes.length >= 8) break;
    const [e, n] = offsetNm(state.home, ap.lat, ap.lon);
    const x = cx + e * scale, y = cy - n * scale;
    const big = ap.size === 'l';
    const code = ap.iata || ap.icao;
    ctx.font = `700 ${big ? 12 : 11}px -apple-system, "Segoe UI", sans-serif`;
    const w = ctx.measureText(code).width;
    const box = { x: x - 6, y: y - 8, w: w + 13, h: 16 };
    if (Math.hypot(x + 7 + w - cx, y - cy) > r - 8 || Math.hypot(x - cx, y - cy) > r - 8 || overlaps(box, boxes)) continue;
    boxes.push(box);
    ctx.strokeStyle = onMap ? '#BFDBFE' : 'rgba(147, 197, 253, 0.7)';
    ctx.lineWidth = big ? 1.8 : 1.4;
    ctx.beginPath(); ctx.arc(x, y, big ? 4.5 : 3.5, 0, Math.PI * 2); ctx.stroke();
    if (onMap) {
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.8)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(code, x + 7, y);
    }
    ctx.fillStyle = onMap ? '#DBEAFE' : 'rgba(147, 197, 253, 0.8)';
    ctx.fillText(code, x + 7, y);
  }
  ctx.restore();
  return boxes;
}

/** Initial great-circle bearing from one point to another, in radians from north. */
function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const k = Math.PI / 180;
  const dLon = (lon2 - lon1) * k;
  const y = Math.sin(dLon) * Math.cos(lat2 * k);
  const x = Math.cos(lat1 * k) * Math.sin(lat2 * k) - Math.sin(lat1 * k) * Math.cos(lat2 * k) * Math.cos(dLon);
  return Math.atan2(y, x);
}

/**
 * For the labelled planes whose route is known: a faint dashed line the way they're going, to
 * the destination if it's on the radar, else to the edge, where the destination's code is shown.
 * Returns the boxes of those codes, so aircraft labels can avoid them.
 */
function drawRoutes(ctx: CanvasRenderingContext2D, planes: Aircraft[], data: AircraftResponse, pos: Map<string, readonly [number, number]>, cx: number, cy: number, r: number, scale: number): Label[] {
  const boxes: Label[] = [];
  const R = r - 4;
  ctx.save();
  ctx.lineWidth = 1.3;
  ctx.font = '700 11px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of planes) {
    const route = data.routes?.[a.hex];
    const p = pos.get(a.hex);
    if (!route || !p || !Number.isFinite(route.toLat) || !Number.isFinite(route.remainingKm)) continue;
    const b = bearingTo(a.lat, a.lon, route.toLat, route.toLon);
    const dx = Math.sin(b), dy = -Math.cos(b);
    const px = p[0] - cx, py = p[1] - cy;
    if (Math.hypot(px, py) >= R) continue;
    // Where the line leaves the disc, and where the destination is: whichever comes first.
    const along = px * dx + py * dy;
    const edge = -along + Math.sqrt(Math.max(0, along * along - (px * px + py * py - R * R)));
    const there = (route.remainingKm / NM_KM) * scale;
    const len = Math.min(edge, there);
    if (len < 24) continue;
    ctx.strokeStyle = altitudeColor(a.altFt, onMap ? 0.8 : 0.45);
    ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(p[0] + dx * 12, p[1] + dy * 12); ctx.lineTo(p[0] + dx * len, p[1] + dy * len); ctx.stroke();
    ctx.setLineDash([]);
    if (there <= edge) continue; // the airport's own marker is there
    const tx = p[0] + dx * (len - 14), ty = p[1] + dy * (len - 14);
    const w = ctx.measureText(route.to).width;
    const box = { x: tx - w / 2 - 3, y: ty - 8, w: w + 6, h: 16 };
    if (overlaps(box, boxes)) continue;
    boxes.push(box);
    if (onMap) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.beginPath(); ctx.roundRect(box.x - 2, box.y, box.w + 4, box.h, 4); ctx.fill();
    }
    ctx.fillStyle = onMap ? '#E2E8F0' : altitudeColor(a.altFt, 0.9);
    ctx.fillText(route.to, tx, ty);
  }
  ctx.restore();
  return boxes;
}

/** A trail in a few bands, fainter towards the oldest end: far fewer strokes than one per segment. */
function strokeTrail(ctx: CanvasRenderingContext2D, pts: number[][], colour: (alpha: number) => string, alpha: number) {
  const bands = 4;
  const segs = pts.length - 1;
  for (let b = 0; b < bands; b++) {
    const from = Math.floor((b * segs) / bands), to = Math.floor(((b + 1) * segs) / bands);
    if (to <= from) continue;
    ctx.strokeStyle = colour(alpha * ((b + 1) / bands));
    ctx.beginPath();
    ctx.moveTo(pts[from][0], pts[from][1]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}

function placeLabel(state: State, hex: string, x: number, y: number, w: number, hgt: number, taken: Label[], bounds: { cx: number; cy: number; r: number }): Label {
  // Near slots first, then the same four directions further out (the leader line covers the gap).
  const slots: Array<[number, number]> = [
    [14, -hgt - 4], [14, 6], [-14 - w, -hgt - 4], [-14 - w, 6],
    [34, -hgt - 22], [34, 24], [-34 - w, -hgt - 22], [-34 - w, 24],
  ];
  const fits = (l: Label) =>
    !overlaps(l, taken) &&
    Math.hypot(l.x + l.w / 2 - bounds.cx, l.y + l.h / 2 - bounds.cy) < bounds.r - 10;
  const order = [state.placement.get(hex) ?? 0, ...slots.keys()];
  for (const i of order) {
    const l = { x: x + slots[i][0], y: y + slots[i][1], w, h: hgt };
    if (fits(l)) { state.placement.set(hex, i); return l; }
  }
  const i = state.placement.get(hex) ?? 0;
  return { x: x + slots[i][0], y: y + slots[i][1], w, h: hgt };
}

function draw(canvas: HTMLCanvasElement, config: HubConfig, state: State) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);

  const cx = w / 2, cy = hgt / 2, r = Math.min(w, hgt) / 2 - 26;
  const radiusNm = config.radarRadiusNm;
  const scale = r / radiusNm;
  syncMap(canvas, config, state, cx, cy, r, scale);
  drawScope(ctx, cx, cy, r, radiusNm);
  const airportBoxes = drawAirports(ctx, state, cx, cy, r, scale);
  // The street map has its own names; the satellite view and the plain radar get ours.
  const placeBoxes = mapChoice(config) === 'map' ? [] : drawPlaces(ctx, state, cx, cy, r, scale, radiusNm, airportBoxes);

  const data = state.data;
  if (data) {
    const feature = featured(data);
    // Positions remembered from a while ago are drawn faded: the planes will have moved on.
    ctx.globalAlpha = Date.now() - data.fetchedAt > 180_000 ? 0.45 : 1;
    // From when the positions were measured, which can be earlier than when they arrived.
    const elapsed = (Date.now() - data.fetchedAt) / 1000;
    const visible = data.aircraft.filter(a => a.altFt !== null);
    const ground = onGround(data);
    const pos = new Map([...visible, ...ground].map(a => {
      const [e, n] = projected(a, state.home, elapsed);
      return [a.hex, [cx + e * scale, cy - n * scale]] as const;
    }));
    const inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) < r - 4;
    drawn = [];

    // Planes on the ground: small and faint, under everything that's flying.
    for (const a of ground) {
      const [x, y] = pos.get(a.hex)!;
      if (!inside(x, y)) continue;
      drawn.push({ a, x, y });
      drawIcon(ctx, a, x, y, 0.5, onMap ? 'rgba(226, 232, 240, 0.6)' : 'rgba(203, 213, 225, 0.38)', onMap ? 'rgba(2, 6, 23, 0.6)' : null);
    }

    // Trails, fading with age and kept inside the disc. Background traffic first, featured on top.
    const ordered = [...visible].sort((a, b) => Number(feature.has(a.hex)) - Number(feature.has(b.hex)));
    const nearestFirst = visible.filter(a => feature.has(a.hex));
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const a of ordered) {
      const trail = state.trails.get(a.hex);
      const [x, y] = pos.get(a.hex)!;
      if (!trail || trail.length < 2 || !inside(x, y)) continue;
      const pts = [...trail.map(([e, n]) => [cx + e * scale, cy - n * scale]), [x, y]];
      const isF = feature.has(a.hex);
      ctx.lineWidth = isF ? 1.6 : 1;
      strokeTrail(ctx, pts, alpha => altitudeColor(a.altFt, alpha), Math.min(1, (isF ? 0.5 : 0.22) * (onMap ? 1.6 : 1)));
    }
    ctx.restore();
    const routeBoxes = drawRoutes(ctx, nearestFirst, data, pos, cx, cy, r, scale);
    drawLookPath(ctx, state, pos, cx, cy, r, scale);

    // Aircraft.
    for (const a of ordered) {
      const [x, y] = pos.get(a.hex)!;
      if (!inside(x, y)) continue;
      drawn.push({ a, x, y });
      const isF = feature.has(a.hex);
      const ring = RING[classify(a)?.kind ?? ''];
      if (ring) {
        ctx.save();
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.5;
        if (ring !== RING.rare) ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, isF ? 14 : 10, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (a.hex === state.lookHex) drawLookRing(ctx, state, x, y, isF ? 19 : 14);
      // A plane that has just come into range fades in, with a faint ring opening round it.
      const arrival = arrivalAge(state, a.hex);
      if (arrival < ARRIVAL_MS) {
        const t = arrival / ARRIVAL_MS;
        if (motionLevel() === 'full') {
          ctx.save();
          ctx.strokeStyle = altitudeColor(a.altFt, 0.55 * (1 - t));
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, 8 + easeOut(t) * 18, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        ctx.globalAlpha *= easeOut(Math.min(1, t * 1.6));
      }
      if (isF) {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        drawIcon(ctx, a, x, y, 1.15, a.emergency ? '#F87171' : altitudeColor(a.altFt), onMap ? 'rgba(2, 6, 23, 0.9)' : null);
        ctx.restore();
      } else {
        // Background traffic: the same silhouette, small.
        drawIcon(ctx, a, x, y, 0.62, altitudeColor(a.altFt, onMap ? 1 : 0.75), onMap ? 'rgba(2, 6, 23, 0.85)' : null);
      }
      if (arrival < ARRIVAL_MS) {
        ctx.restore();
      }
    }

    // Labels for featured aircraft only, placed so they don't collide.
    // Home and every featured aircraft are reserved first, so no label covers a plane.
    const taken: Label[] = [{ x: cx - 12, y: cy - 12, w: 24, h: 24 }, ...airportBoxes, ...placeBoxes, ...routeBoxes, ...nearestFirst.map(a => {
      const [x, y] = pos.get(a.hex)!;
      return { x: x - 10, y: y - 10, w: 20, h: 20 };
    })];
    for (const a of nearestFirst) {
      const [x, y] = pos.get(a.hex)!;
      if (!inside(x, y)) continue;
      ctx.font = '600 13px -apple-system, "Segoe UI", sans-serif';
      const line1 = name(a);
      // The type code, as the trackers show it (A320, B77W), then the height.
      const line2 = [a.type, fmtAlt(a)].filter(Boolean).join(' · ');
      const tw = Math.max(ctx.measureText(line1).width, (ctx.font = '500 11px -apple-system, "Segoe UI", sans-serif', ctx.measureText(line2).width));
      const l = placeLabel(state, a.hex, x, y, tw, 30, taken, { cx, cy, r });
      taken.push(l);
      // Leader line from the aircraft to the nearest corner of its label.
      const lx = l.x > x ? l.x - 3 : l.x + l.w + 3;
      const ly = l.y > y ? l.y + 4 : l.y + l.h - 4;
      ctx.strokeStyle = onMap ? 'rgba(241, 245, 249, 0.75)' : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lx, ly); ctx.stroke();
      if (onMap) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.beginPath(); ctx.roundRect(l.x - 6, l.y - 4, l.w + 12, l.h + 4, 7); ctx.fill();
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '600 13px -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = a.emergency ? '#FCA5A5' : '#F1F5F9';
      ctx.fillText(line1, l.x, l.y);
      ctx.font = '500 11px -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = onMap ? '#CBD5E1' : 'rgba(148, 163, 184, 0.95)';
      ctx.fillText(line2, l.x, l.y + 16);
    }
  }

  ctx.globalAlpha = 1;
  drawHome(ctx, cx, cy, r, performance.now() - state.pingAt);
  drawLookWave(ctx, state, cx, cy, r);
}

// ---- Motion for the look-up plane and newcomers (see motion.ts for what each level allows) ----

const ARRIVAL_MS = 1400;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const arrivalAge = (state: State, hex: string) => performance.now() - (state.firstSeen.get(hex) ?? -1e9);

/** Seconds until the look-up plane is closest to home, counting on from when it was measured. */
function secondsToPass(state: State): number | null {
  if (!state.look) return null;
  return state.look.pass.inSec - (Date.now() - state.look.dataAt) / 1000;
}

/** Where the look-up plane will be closest to home, on the radar. */
function closestPoint(state: State, cx: number, cy: number, scale: number): [number, number] | null {
  if (!state.look) return null;
  const { bearingDeg, distKm } = state.look.pass;
  const b = (bearingDeg * Math.PI) / 180;
  const nm = distKm / NM_KM;
  return [cx + Math.sin(b) * nm * scale, cy - Math.cos(b) * nm * scale];
}

/**
 * A dashed line from the look-up plane to where it will pass closest to home, with a small mark
 * there. With full motion the dashes flow towards that point, so the way it's going reads at once.
 */
function drawLookPath(ctx: CanvasRenderingContext2D, state: State, pos: Map<string, readonly [number, number]>, cx: number, cy: number, r: number, scale: number) {
  const left = secondsToPass(state);
  const from = state.lookHex ? pos.get(state.lookHex) : undefined;
  const to = closestPoint(state, cx, cy, scale);
  if (left === null || left < 5 || !from || !to) return;
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 18 || Math.hypot(from[0] - cx, from[1] - cy) > r) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  if (motionLevel() === 'full') ctx.lineDashOffset = -(performance.now() / 70) % 11;
  ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke();
  ctx.setLineDash([]);
  // The closest point: a small open ring (over home it would only hide the home mark).
  if (Math.hypot(to[0] - cx, to[1] - cy) > 12) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.strokeStyle = LOOK_RING;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(to[0], to[1], 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** The look-up plane's ring: steady, or with full motion breathing slowly, then quicker as it nears. */
function drawLookRing(ctx: CanvasRenderingContext2D, state: State, x: number, y: number, radius: number) {
  const left = Math.max(0, secondsToPass(state) ?? 600);
  let grow = 0, alpha = 1;
  if (motionLevel() === 'full') {
    // One breath every 3.2 s with ten minutes to go, down to every 1.2 s in the last minute.
    const period = 1200 + Math.min(1, left / 600) * 2000;
    const phase = (Math.sin((performance.now() / period) * Math.PI * 2) + 1) / 2;
    grow = phase * 4;
    alpha = 0.55 + phase * 0.45;
  }
  ctx.save();
  ctx.strokeStyle = LOOK_RING;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, radius + grow, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** One soft wave from home towards the sky when the look-up plane is about to go over. Full motion only. */
function drawLookWave(ctx: CanvasRenderingContext2D, state: State, cx: number, cy: number, r: number) {
  const left = secondsToPass(state);
  const hex = state.lookHex;
  if (hex && left !== null && left < 40 && left > -20 && (state.look?.pass.distKm ?? 99) <= 4 && state.wave?.hex !== hex) {
    state.wave = { hex, at: performance.now() };
  }
  if (!state.wave || motionLevel() !== 'full') return;
  const t = (performance.now() - state.wave.at) / 2200;
  if (t >= 1) return;
  ctx.save();
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.45 * (1 - t)})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 10 + easeOut(t) * r * 0.35, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Keeps the map under the radar in step with its size, place, range and style. */
function syncMap(canvas: HTMLCanvasElement, config: HubConfig, state: State, cx: number, cy: number, r: number, scale: number) {
  const choice = mapChoice(config);
  onMap = choice !== 'plain';
  const key = `${choice}|${state.home.lat},${state.home.lon}|${Math.round(r)}|${config.radarRadiusNm}|${Math.round(cx)},${Math.round(cy)}`;
  if (key === state.mapKey) return;
  state.mapKey = key;
  const stage = canvas.parentElement!;
  stage.querySelectorAll('.radar-map, .radar-credit').forEach(e => e.remove());
  // The map's credit is a condition of using it free; it's kept short and faint.
  if (choice === 'plain' || r < 20) return;
  stage.append(h('span', 'radar-credit', TILE_SOURCES[choice].credit));
  const disc = tileDisc(TILE_SOURCES[choice], state.home.lat, state.home.lon, r, scale);
  disc.dataset.map = choice;
  disc.style.left = `${cx - r}px`;
  disc.style.top = `${cy - r}px`;
  disc.style.width = disc.style.height = `${2 * r}px`;
  stage.prepend(disc);
}

/** Which airline logos loaded (true) or don't exist (false), so the list doesn't flicker on each refresh. */
const logoKnown = new Map<string, boolean>();

/** The airline's logo on a small white plaque, once it's known to exist. */
function airlineLogo(iata: string): HTMLImageElement | null {
  if (logoKnown.get(iata) === false) return null;
  const img = h('img', 'radar-logo');
  img.alt = '';
  img.decoding = 'async';
  if (logoKnown.get(iata)) img.classList.add('on');
  img.addEventListener('load', () => { logoKnown.set(iata, true); img.classList.add('on'); });
  img.addEventListener('error', () => { logoKnown.set(iata, false); img.remove(); });
  void setApiImage(img, `/api/logo/${encodeURIComponent(iata)}`);
  return img;
}

/** ↑ or ↓ beside the height while climbing or descending at a few hundred feet a minute or more. */
function climbMark(a: Aircraft): HTMLElement | null {
  const vs = a.verticalRateFpm;
  if (vs == null || Math.abs(vs) < 300) return null;
  const mark = h('span', `radar-climb ${vs > 0 ? 'up' : 'down'}`, vs > 0 ? '↑' : '↓');
  mark.setAttribute('aria-label', vs > 0 ? 'climbing' : 'descending');
  return mark;
}

/** A list row with a plane row's three lines, so it is exactly as tall; `text` on the first line. */
function shapedRow(text: string, cls: string): HTMLElement {
  const li = h('li', cls);
  const main = h('div', 'radar-main');
  const top = h('div', 'radar-top');
  top.append(h('span', 'radar-name', text || '\u00a0'));
  const second = h('div', 'radar-second');
  second.append(h('span', 'radar-route', '\u00a0'));
  main.append(top, second, h('span', 'radar-meta', '\u00a0'));
  li.append(h('span', 'radar-dot'), main);
  return li;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A small drawn arrow, turned to a compass bearing (0 points up, which is north on the radar). */
function arrow(cls: string, deg: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--deg', `${Math.round(deg)}deg`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M12 3 L18.5 19 L12 15.2 L5.5 19 Z');
  svg.append(path);
  return svg;
}

/** "Right above you": a ring round a dot, for a plane passing straight overhead. */
function overheadMark(cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `${cls} overhead`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', '12'); ring.setAttribute('cy', '12'); ring.setAttribute('r', '8.5');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', '12'); dot.setAttribute('cy', '12'); dot.setAttribute('r', '3.5');
  svg.append(ring, dot);
  return svg;
}

/** The altitude key, drawn once into the radar's corner. */
function altitudeKey(): HTMLElement {
  const legend = h('div', 'radar-legend');
  legend.setAttribute('aria-hidden', 'true');
  legend.append(h('span', 'legend-title', 'Altitude'));
  const bar = h('div', 'legend-bar');
  bar.style.background = `linear-gradient(90deg, ${ALT_STOPS.map(([ft]) => `${altitudeColor(ft)} ${(ft / 38000) * 100}%`).join(', ')})`;
  const ticks = h('div', 'legend-ticks');
  ticks.append(h('span', undefined, '0'), h('span', undefined, '12k'), h('span', undefined, '25k'), h('span', undefined, '38k ft'));
  legend.append(bar, ticks);
  return legend;
}

function renderPanel(panel: HTMLElement, config: HubConfig, state: State) {
  const data = state.data;
  const head = h('header', 'radar-head');
  head.append(h('h2', undefined, 'Nearby'));
  const airborne = data ? data.aircraft.filter(a => a.altFt !== null) : [];
  const grounded = data ? onGround(data).length : 0;
  const age = data ? ageLabel(data.fetchedAt) : null;
  // The range rings already say how far out the radar looks, so the count stays on one line.
  head.append(h('p', 'radar-sub', data
    ? [`${airborne.length} in the air`, grounded ? `${grounded} on the ground` : null, age].filter(Boolean).join(' · ')
    : `Looking for aircraft near ${state.home.name}…`));
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' });
  const list = h('ol', 'radar-list');

  // Look up: the next plane to pass over (or closest to) home, where to look, and an arrow that
  // points there (north is up, as on the radar). The same plane is ringed on the radar.
  const pass = data ? nextOverhead(data.aircraft) : null;
  state.lookHex = pass?.aircraft.hex;
  state.look = pass && data ? { pass, dataAt: data.fetchedAt } : undefined;
  const look = h('div', `radar-look${pass ? '' : ' quiet'}`);
  if (pass) {
    const parts = lookUpParts(pass);
    look.dataset.hex = pass.aircraft.hex;
    const text = h('div', 'look-text');
    const title = h('p', 'look-title');
    title.append(h('b', undefined, name(pass.aircraft)), h('span', 'look-when', parts.when));
    const where = parts.where.charAt(0).toLowerCase() + parts.where.slice(1);
    text.append(title, h('p', 'look-where', `${parts.pass} · ${where}`));
    look.append(parts.overhead ? overheadMark('look-arrow') : arrow('look-arrow', pass.bearingDeg), text);
  } else {
    look.append(h('p', 'look-where', 'Nothing heading over in the next 15 minutes'));
  }

  // In portrait the list is always the same height (so the radar above it never changes size):
  // a fixed number of rows, kept even when fewer planes are about, and the "+N more" line
  // always there. Landscape keeps the list beside the radar, where its height doesn't matter.
  const fixed = isPortrait();
  const slots = listed();
  if (data) {
    const feature = featured(data);
    let rows = airborne.filter(a => feature.has(a.hex));
    if (fixed && rows.length > slots) {
      // More emergencies and rare aircraft than rows: those first, then the nearest, in distance order.
      const special = (a: Aircraft) => a.emergency || classify(a)?.kind === 'rare';
      const keep = new Set([...rows.filter(special), ...rows].slice(0, slots).map(a => a.hex));
      rows = rows.filter(a => keep.has(a.hex));
    }
    for (const a of rows) {
      const route: RouteSummary | undefined = data.routes?.[a.hex];
      const notable = classify(a);
      const li = h('li', `radar-row${a.emergency ? ' emergency' : ''}`);
      li.dataset.hex = a.hex;
      li.style.setProperty('--alt', a.emergency ? '#F87171' : altitudeColor(a.altFt));
      // Three lines, each with one job: who it is and how high, where it's going, then the
      // smaller figures. The squawk and the rest are on the plane card.
      const main = h('div', 'radar-main');
      const top = h('div', 'radar-top');
      const who = h('span', 'radar-name');
      const iata = route?.airlineIata ?? data.airlines?.[a.hex]?.iata;
      const logo = iata ? airlineLogo(iata) : null;
      if (logo) who.append(logo);
      who.append(h('b', undefined, name(a)));
      const alt = h('span', 'radar-alt', fmtAlt(a));
      const climb = climbMark(a);
      if (climb) alt.append(climb);
      top.append(who, alt);
      // The second line: where it's going (or what it is), and on the right, the height the
      // autopilot is taking it to while it climbs or descends.
      const second = h('div', 'radar-second');
      second.append(h('span', 'radar-route', a.emergency ? `Squawk ${a.squawk ?? 'emergency'}`
        : notable?.kind === 'rare' ? notable.title
          : route ? `${route.fromCity} → ${route.toCity}` : [typeName(a.desc) ?? a.type, regRepeats(a) ? null : a.registration].filter(Boolean).join(' · ') || '—'));
      const target = targetShort(a);
      if (target) second.append(h('span', 'radar-target', target));
      main.append(top, second);
      // When it should land, roughly, from how far it has to go and how fast it's going.
      // (Positions remembered from before routes carried the distance left have no figure.)
      const togo = route && Number.isFinite(route.remainingKm) ? minutesToGo(route.remainingKm, a) : null;
      main.append(h('span', 'radar-meta', [
        togo !== null ? `lands ${clock.format(new Date(data.fetchedAt + togo * 60_000))}` : null,
        a.groundSpeedKt != null ? `${Math.round(a.groundSpeedKt * NM_KM).toLocaleString('en-GB')} km/h` : null,
        `${(a.distanceNm * NM_KM).toFixed(a.distanceNm < 5 ? 1 : 0)} km away`,
      ].filter(Boolean).join(' · ')));
      li.append(h('span', 'radar-dot'), main);
      list.append(li);
    }
    if (!rows.length) list.append(h('li', 'radar-empty', 'Clear skies right now.'));
    // The heading counts every plane in range; say where the rest are so the numbers add up.
    const more = airborne.length - rows.length;
    if (rows.length && more > 0) list.append(h('li', 'radar-more', `+${more} more on the radar`));
  }
  if (state.error) list.append(h('li', 'radar-empty', state.error));
  if (fixed) {
    // A message ("Clear skies") takes a row of the same shape; spare rows are invisible copies.
    for (const msg of list.querySelectorAll('.radar-empty')) msg.replaceWith(shapedRow(msg.textContent ?? '', 'radar-row radar-note'));
    const used = list.querySelectorAll('.radar-row').length;
    const more = list.querySelector('.radar-more');
    for (let i = used; i < slots; i++) {
      const blank = shapedRow('', 'radar-row radar-blank');
      blank.setAttribute('aria-hidden', 'true');
      list.insertBefore(blank, more);
    }
    if (!more) {
      const spacer = h('li', 'radar-more', ' ');
      spacer.setAttribute('aria-hidden', 'true');
      list.append(spacer);
    }
  }

  // The wind high up, from the planes' own reports, and what the display has seen today.
  const facts = h('footer', 'radar-facts');
  const wind = data ? windAloft(data.aircraft) : null;
  const windLine = h('p', 'radar-wind');
  if (wind) windLine.append(arrow('wind-arrow', wind.fromDeg + 180));
  windLine.append(h('span', undefined, wind ? windText(wind) : 'Wind high up: waiting for a plane to report it'));
  const today = skyToday(config.timezone);
  const [t1] = today ? tallyLines(today) : ['Counting today\u2019s planes'];
  const count = h('p', 'radar-today');
  count.append(h('b', undefined, 'Today'), h('span', undefined, t1));
  // The records, each with the plane that set it (which the narrow landscape panel leaves out).
  const records = h('p', 'radar-records');
  const recs = today ? tallyRecords(today) : [];
  recs.forEach(([what, who], i) => {
    if (i) records.append(' · ');
    records.append(what, h('span', 'rec-who', ` (${who})`));
  });
  if (!recs.length) records.append('\u00a0');
  facts.append(windLine, count, records);

  const before = measureRows(panel);
  const turns = arrowAngles(panel);
  panel.replaceChildren(head, look, list, facts);
  glideRows(panel, before);
  turnArrows(panel, turns);
}

/** Where each plane's row was, and the arrows' angles, before the panel is redrawn. */
function measureRows(panel: HTMLElement): Map<string, DOMRect> {
  const at = new Map<string, DOMRect>();
  for (const row of panel.querySelectorAll<HTMLElement>('.radar-row[data-hex]')) at.set(row.dataset.hex!, row.getBoundingClientRect());
  return at;
}
function arrowAngles(panel: HTMLElement): Map<string, number> {
  const at = new Map<string, number>();
  for (const svg of panel.querySelectorAll<SVGSVGElement>('.look-arrow:not(.overhead), .wind-arrow')) {
    at.set(svg.classList[0], parseFloat(svg.style.getPropertyValue('--deg')) || 0);
  }
  return at;
}

const GLIDE = { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };

/**
 * Rows follow their plane: a row that moved slides from where it was (full motion), and a plane
 * new to the list fades in (full and gentle). Nothing moves on the panel's first drawing.
 */
function glideRows(panel: HTMLElement, before: Map<string, DOMRect>) {
  const level = motionLevel();
  if (level === 'still' || !before.size || !panel.isConnected) return;
  for (const row of panel.querySelectorAll<HTMLElement>('.radar-row[data-hex]')) {
    const was = before.get(row.dataset.hex!);
    if (!was) { row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' }); continue; }
    if (level !== 'full') continue;
    const now = row.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) continue;
    row.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], GLIDE);
  }
}

/** The look-up and wind arrows turn the short way round to their new direction (full motion). */
function turnArrows(panel: HTMLElement, before: Map<string, number>) {
  if (motionLevel() !== 'full') return;
  for (const svg of panel.querySelectorAll<SVGSVGElement>('.look-arrow:not(.overhead), .wind-arrow')) {
    const was = before.get(svg.classList[0]);
    if (was === undefined) continue;
    const to = parseFloat(svg.style.getPropertyValue('--deg')) || 0;
    const turn = ((to - was + 540) % 360) - 180;
    if (Math.abs(turn) < 1) continue;
    svg.animate([{ transform: `rotate(${to - turn}deg)` }, { transform: `rotate(${to}deg)` }], { duration: 600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
}

export const radarScreen: Screen = {
  id: 'radar',
  title: 'Radar',
  mount(el: HTMLElement, config: HubConfig) {
    currentConfig = config;
    const stage = h('div', 'radar-stage');
    const canvas = h('canvas', 'radar');
    canvasEl = canvas;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Radar of aircraft around home');
    stage.append(canvas, altitudeKey());
    const panel = h('aside', 'radar-panel');
    el.append(stage, panel);

    const state: State = { home: config.home, data: null, receivedAt: 0, trails: new Map(), placement: new Map(), pingAt: -1e9, error: null, mapKey: '', places: [], airports: [], wantTrails: true, firstSeen: new Map() };
    current = state;
    const age = watchAge(el, config.timezone, () => state.data?.fetchedAt ?? null, () => renderPanel(panel, config, state));
    stopAge = age.stop;
    // Displays used to keep their own choice; it's in /setup now.
    try { localStorage.removeItem('hub.radarMap'); } catch { /* storage unavailable */ }

    const poll = async (): Promise<Outcome> => {
      try {
        const data = await getJson<AircraftResponse>(`/api/aircraft?routes=${ROUTES}${state.wantTrails ? '&trails=1' : ''}&${skyQuery(state.home)}`);
        // Never swap newer positions for older ones (a stale answer can be older than what we show).
        if (state.data && data.fetchedAt <= state.data.fetchedAt) {
          renderPanel(panel, config, state);
          return 'failed';
        }
        const now = data.fetchedAt / 1000;
        const seen = new Set<string>();
        for (const a of data.aircraft) {
          if (a.altFt === null) continue;
          seen.add(a.hex);
          // Where the shared fetcher remembers it being, the first time; after that, our own points.
          const known = state.trails.get(a.hex) ?? (data.trails?.[a.hex] ?? []).map(([lat, lon, t]): [number, number, number] => [...offsetNm(state.home, lat, lon), t]);
          const t = known.filter(p => p[2] < now && now - p[2] <= TRAIL_SECONDS);
          t.push([...offsetNm(state.home, a.lat, a.lon), now]);
          state.trails.set(a.hex, t);
        }
        for (const hex of [...state.trails.keys()]) if (!seen.has(hex)) { state.trails.delete(hex); state.placement.delete(hex); }
        // Newcomers fade in; on the first answer for a place everything is simply there.
        const firstAnswer = state.firstSeen.size === 0;
        const t0 = performance.now();
        for (const hex of seen) if (!state.firstSeen.has(hex)) state.firstSeen.set(hex, firstAnswer ? -1e9 : t0);
        for (const hex of [...state.firstSeen.keys()]) if (!seen.has(hex)) state.firstSeen.delete(hex);
        // The trails aren't kept with the remembered positions: they'd be old by the time they're shown.
        const { trails: _trails, ...keep } = data;
        Object.assign(state, { data: keep, receivedAt: Date.now(), error: null, pingAt: performance.now(), wantTrails: false });
        if (!data.stale) { remember('aircraft', state.home, keep); countSky(data.aircraft, config.timezone); }
        renderPanel(panel, config, state);
        age.check();
        return data.stale ? 'failed' : data.aircraft.length ? 'found' : 'empty';
      } catch {
        // The free sources often refuse a request; what's on screen stays, and we try again soon.
        state.error = state.data ? null : 'Live positions are delayed. Retrying.';
        renderPanel(panel, config, state);
        return 'failed';
      }
    };

    let last = 0;
    const loop = (now: number) => {
      if (now - last >= FRAME_MS) { last = now; draw(canvas, config, state); }
      frame = requestAnimationFrame(loop);
    };

    // Re-centre: on mount, and when the middle of the screen is tapped to change place.
    retarget = () => {
      skyHome(config).then(home => {
        // Show the last planes seen here straight away, while fresh positions load.
        Object.assign(state, { home, data: recall<AircraftResponse>('aircraft', home), error: null, wantTrails: true, airports: [] });
        state.trails.clear();
        state.placement.clear();
        state.firstSeen.clear();
        renderPanel(panel, config, state);
        airportsAround(home.lat, home.lon, config.radarRadiusNm)
          .then(airports => { if (state.home === home) state.airports = airports; })
          .catch(() => { /* airports are a nicety too */ });
        state.places = recall<{ fetchedAt: number; places: PlaceName[] }>('places', home)?.places ?? [];
        placesAround(home.lat, home.lon, config.radarRadiusNm)
          .then(places => {
            if (state.home !== home || !places.length) return;
            state.places = places;
            const known = { fetchedAt: Date.now(), places };
            remember('places', home, known);
          })
          .catch(() => { /* names are a nicety; the radar works without them */ });
        refresher?.stop();
        refresher = new Refresher(poll);
        refresher.now();
      });
    };
    renderPanel(panel, config, state);
    retarget();
    frame = requestAnimationFrame(loop);
  },
  onCenterTap() {
    const next = retarget && nextPlace(currentConfig!);
    if (!next) return;
    retarget!();
    return `Centred on ${next === 'device' ? 'this display' : currentConfig!.places.find(p => p.id === next)?.name ?? 'home'}`;
  },
  aircraftAt(x: number, y: number, target: Element, reach: number) {
    // A row in the list, or the plane nearest the tap on the radar (within a fingertip).
    // Planes in the air win over the crowd parked at an airport, unless the tap is right on one.
    const hex = target.closest<HTMLElement>('[data-hex]')?.dataset.hex;
    if (hex) return current?.data?.aircraft.find(a => a.hex === hex) ?? null;
    if (!canvasEl || target !== canvasEl) return null;
    const box = canvasEl.getBoundingClientRect();
    const hit = drawn
      .map(d => ({ a: d.a, gap: Math.hypot(d.x - (x - box.left), d.y - (y - box.top)) + (d.a.onGround ? 12 : 0) }))
      .filter(d => d.gap < reach)
      .sort((p, q) => p.gap - q.gap)[0];
    return hit?.a ?? null;
  },
  unmount() {
    stopAge?.();
    stopAge = undefined;
    refresher?.stop();
    refresher = undefined;
    if (frame) cancelAnimationFrame(frame);
    retarget = undefined;
    current = canvasEl = undefined;
    drawn = [];
  },
};
