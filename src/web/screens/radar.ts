import type { RadarMap } from '../../shared/settings';
import type { Aircraft, AircraftResponse, HubConfig, PlaceName, RouteSummary } from '../../shared/types';
import { getJson } from '../api';
import { tileDisc, TILE_SOURCES } from '../mapTiles';
import { placesAround } from '../placeNames';
import { nextPlace, skyHome, skyQuery, type SkyHome } from '../location';
import { motionLevel } from '../motion';
import { ageLabel, recall, Refresher, remember, type Outcome } from '../skyCache';
import { h, type Screen } from '../screen';

// An ambient radar for a room: calm at a glance, detailed on a closer look.
// Only the few nearest aircraft are labelled; everything else is a small heading mark
// coloured by altitude. The one animation that carries meaning is the ping that ripples
// out from home each time fresh positions arrive.

const FEATURED = 5;
const TRAIL_POINTS = 8;
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

const fmtAlt = (a: Aircraft) => (a.altFt == null ? '' : a.altFt >= 10000 ? `FL${Math.round(a.altFt / 100)}` : `${a.altFt.toLocaleString('en-GB')} ft`);
const name = (a: Aircraft) => a.callsign ?? a.registration ?? a.hex.toUpperCase();

// A small aircraft silhouette pointing up (north), about 16 px nose to tail at scale 1.
const PLANE = new Path2D('M0 -8 L1.3 -5.6 L1.3 -2.2 L7.5 1.6 L7.5 3 L1.3 1.2 L1 5.3 L3 6.8 L3 7.8 L0 7 L-3 7.8 L-3 6.8 L-1 5.3 L-1.3 1.2 L-7.5 3 L-7.5 1.6 L-1.3 -2.2 L-1.3 -5.6 Z');

interface Label { x: number; y: number; w: number; h: number }

interface State {
  home: SkyHome;
  data: AircraftResponse | null;
  receivedAt: number;
  trails: Map<string, Array<[number, number]>>; // hex -> [eastNm, northNm], oldest first
  placement: Map<string, number>; // hex -> chosen label slot, kept stable between frames
  pingAt: number;
  error: string | null;
  /** What the map layer was last built for; it's rebuilt when this changes. */
  mapKey: string;
  /** Towns and cities around home, biggest first, for labelling. */
  places: PlaceName[];
}

let refresher: Refresher | undefined;
let frame: number | undefined;
let retarget: (() => void) | undefined;
let currentConfig: HubConfig | undefined;

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

/** How many planes get a label and a row in the list: fewer on a phone, where space is short. */
const listed = () => (window.matchMedia('(max-height: 520px)').matches ? 3 : FEATURED);

function featured(data: AircraftResponse): Set<string> {
  const airborne = data.aircraft.filter(a => a.altFt !== null);
  return new Set([...airborne.filter(a => a.emergency), ...airborne.slice(0, listed())].map(a => a.hex));
}

/** Where the range rings' distance labels go: along the 135° bearing, where traffic is rarely drawn. */
function ringLabels(cx: number, cy: number, r: number, radiusNm: number): Array<{ nm: number; x: number; y: number }> {
  const step = radiusNm <= 30 ? 5 : radiusNm <= 60 ? 10 : 25;
  const out = [];
  const a = (135 * Math.PI) / 180;
  for (let nm = step; nm < radiusNm; nm += step) {
    if (nm % (step * 2) !== 0 && radiusNm / step > 4) continue;
    const rr = (nm / radiusNm) * r;
    out.push({ nm, x: cx + Math.sin(a) * rr, y: cy - Math.cos(a) * rr });
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
  const step = radiusNm <= 30 ? 5 : radiusNm <= 60 ? 10 : 25;
  ctx.save();
  ctx.setLineDash([2, 6]);
  ctx.strokeStyle = onMap ? 'rgba(241, 245, 249, 0.5)' : 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = onMap ? 1.2 : 1;
  ctx.font = '600 12px -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = '#94A3B8'; // 6.3:1 on the disc
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let nm = step; nm < radiusNm; nm += step) {
    ctx.beginPath(); ctx.arc(cx, cy, (nm / radiusNm) * r, 0, Math.PI * 2); ctx.stroke();
  }
  for (const { nm, x: lx, y: ly } of ringLabels(cx, cy, r, radiusNm)) {
    if (onMap) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.beginPath(); ctx.roundRect(lx - 11, ly - 9, 22, 18, 5); ctx.fill();
      ctx.fillStyle = '#E2E8F0';
    }
    ctx.fillText(`${nm}`, lx, ly);
    ctx.fillStyle = '#94A3B8';
  }
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
function drawPlaces(ctx: CanvasRenderingContext2D, state: State, cx: number, cy: number, r: number, scale: number, radiusNm: number): Label[] {
  if (!state.places.length) return [];
  const max = listed() === FEATURED ? 12 : 5;
  const dist = (p: PlaceName) => Math.hypot(...offsetNm(state.home, p.lat, p.lon));
  const villages = state.places.filter(p => p.kind === 'village' && dist(p) < radiusNm * 0.25).sort((a, b) => dist(a) - dist(b)).slice(0, 3);
  const candidates = [...state.places.filter(p => p.kind !== 'village'), ...villages];
  const sat = onMap;
  const boxes: Label[] = [];
  // Home and the ring distances stay clear.
  const taken: Label[] = [{ x: cx - 14, y: cy - 14, w: 28, h: 28 }, ...ringLabels(cx, cy, r, radiusNm).map(l => ({ x: l.x - 13, y: l.y - 10, w: 26, h: 20 }))];
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

function placeLabel(state: State, hex: string, x: number, y: number, w: number, hgt: number, taken: Label[], bounds: { cx: number; cy: number; r: number }): Label {
  // Near slots first, then the same four directions further out (the leader line covers the gap).
  const slots: Array<[number, number]> = [
    [14, -hgt - 4], [14, 6], [-14 - w, -hgt - 4], [-14 - w, 6],
    [34, -hgt - 22], [34, 24], [-34 - w, -hgt - 22], [-34 - w, 24],
  ];
  const fits = (l: Label) =>
    !taken.some(o => l.x < o.x + o.w && l.x + l.w > o.x && l.y < o.y + o.h && l.y + l.h > o.y) &&
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
  // The street map has its own names; the satellite view and the plain radar get ours.
  const placeBoxes = mapChoice(config) === 'map' ? [] : drawPlaces(ctx, state, cx, cy, r, scale, radiusNm);

  const data = state.data;
  if (data) {
    const feature = featured(data);
    // Positions remembered from a while ago are drawn faded: the planes will have moved on.
    ctx.globalAlpha = Date.now() - data.fetchedAt > 180_000 ? 0.45 : 1;
    // From when the positions were measured, which can be earlier than when they arrived.
    const elapsed = (Date.now() - data.fetchedAt) / 1000;
    const visible = data.aircraft.filter(a => a.altFt !== null);
    const pos = new Map(visible.map(a => {
      const [e, n] = projected(a, state.home, elapsed);
      return [a.hex, [cx + e * scale, cy - n * scale]] as const;
    }));
    const inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) < r - 4;

    // Trails, fading with age. Background traffic first, featured on top.
    const ordered = [...visible].sort((a, b) => Number(feature.has(a.hex)) - Number(feature.has(b.hex)));
    for (const a of ordered) {
      const trail = state.trails.get(a.hex);
      const [x, y] = pos.get(a.hex)!;
      if (!trail || trail.length < 2 || !inside(x, y)) continue;
      const pts = [...trail.map(([e, n]) => [cx + e * scale, cy - n * scale]), [x, y]];
      const isF = feature.has(a.hex);
      ctx.lineWidth = isF ? 1.6 : 1;
      ctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = altitudeColor(a.altFt, Math.min(1, (isF ? 0.5 : 0.22) * (onMap ? 1.6 : 1)) * (i / (pts.length - 1)));
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
    }

    // Aircraft.
    for (const a of ordered) {
      const [x, y] = pos.get(a.hex)!;
      if (!inside(x, y)) continue;
      const isF = feature.has(a.hex);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((a.trackDeg ?? 0) * Math.PI) / 180);
      if (isF) {
        ctx.scale(1.15, 1.15);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = a.emergency ? '#F87171' : altitudeColor(a.altFt);
        if (onMap) { ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(PLANE); }
        ctx.fill(PLANE);
      } else {
        // Background traffic: a small heading chevron.
        ctx.fillStyle = altitudeColor(a.altFt, onMap ? 1 : 0.75);
        ctx.beginPath(); ctx.moveTo(0, -4.5); ctx.lineTo(3.2, 3.5); ctx.lineTo(0, 1.8); ctx.lineTo(-3.2, 3.5); ctx.closePath();
        if (onMap) { ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke(); }
        ctx.fill();
      }
      ctx.restore();
    }

    // Labels for featured aircraft only, placed so they don't collide.
    // Home and every featured aircraft are reserved first, so no label covers a plane.
    const nearestFirst = visible.filter(a => feature.has(a.hex));
    const taken: Label[] = [{ x: cx - 12, y: cy - 12, w: 24, h: 24 }, ...placeBoxes, ...nearestFirst.map(a => {
      const [x, y] = pos.get(a.hex)!;
      return { x: x - 10, y: y - 10, w: 20, h: 20 };
    })];
    for (const a of nearestFirst) {
      const [x, y] = pos.get(a.hex)!;
      if (!inside(x, y)) continue;
      ctx.font = '600 13px -apple-system, "Segoe UI", sans-serif';
      const line1 = name(a);
      const line2 = fmtAlt(a);
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
  disc.style.left = `${cx - r}px`;
  disc.style.top = `${cy - r}px`;
  disc.style.width = disc.style.height = `${2 * r}px`;
  stage.prepend(disc);
}

function renderPanel(panel: HTMLElement, config: HubConfig, state: State) {
  const data = state.data;
  const head = h('header', 'radar-head');
  head.append(h('h2', undefined, 'Overhead'));
  const airborne = data ? data.aircraft.filter(a => a.altFt !== null) : [];
  const age = data ? ageLabel(data.fetchedAt) : null;
  head.append(h('p', 'radar-sub', data
    ? `${airborne.length} aircraft within ${config.radarRadiusNm} nm of ${state.home.name}${age ? ` · ${age}` : ''}`
    : `Looking for aircraft near ${state.home.name}…`));
  const list = h('ol', 'radar-list');

  if (data) {
    const feature = featured(data);
    const rows = airborne.filter(a => feature.has(a.hex));
    for (const a of rows) {
      const route: RouteSummary | undefined = data.routes?.[a.hex];
      const li = h('li', `radar-row${a.emergency ? ' emergency' : ''}`);
      li.style.setProperty('--alt', a.emergency ? '#F87171' : altitudeColor(a.altFt));
      const main = h('div', 'radar-main');
      main.append(h('b', undefined, name(a)));
      main.append(h('span', 'radar-route', a.emergency ? `Squawk ${a.squawk ?? 'emergency'}`
        : route ? `${route.fromCity} → ${route.toCity}` : [a.type, a.registration].filter(Boolean).join(' · ') || '—'));
      const figs = h('div', 'radar-figs');
      figs.append(h('span', undefined, fmtAlt(a)), h('span', undefined, `${(a.distanceNm * 1.852).toFixed(a.distanceNm < 5 ? 1 : 0)} km`));
      li.append(h('span', 'radar-dot'), main, figs);
      list.append(li);
    }
    if (!rows.length) list.append(h('li', 'radar-empty', 'Clear skies right now.'));
    // The heading counts every plane in range; say where the rest are so the numbers add up.
    const more = airborne.length - rows.length;
    if (rows.length && more > 0) list.append(h('li', 'radar-more', `+${more} more on the radar`));
  }
  if (state.error) list.append(h('li', 'radar-empty', state.error));

  const legend = h('div', 'radar-legend');
  legend.append(h('span', 'legend-title', 'Altitude'));
  const bar = h('div', 'legend-bar');
  bar.style.background = `linear-gradient(90deg, ${ALT_STOPS.map(([ft]) => `${altitudeColor(ft)} ${(ft / 38000) * 100}%`).join(', ')})`;
  const ticks = h('div', 'legend-ticks');
  ticks.append(h('span', undefined, 'Ground'), h('span', undefined, '12k'), h('span', undefined, '25k'), h('span', undefined, '38k ft'));
  legend.append(bar, ticks);

  panel.replaceChildren(head, list, legend);
}

export const radarScreen: Screen = {
  id: 'radar',
  title: 'Radar',
  durationSec: 60,
  mount(el: HTMLElement, config: HubConfig) {
    currentConfig = config;
    const stage = h('div', 'radar-stage');
    const canvas = h('canvas', 'radar');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Radar of aircraft around home');
    stage.append(canvas);
    const panel = h('aside', 'radar-panel');
    el.append(stage, panel);

    const state: State = { home: config.home, data: null, receivedAt: 0, trails: new Map(), placement: new Map(), pingAt: -1e9, error: null, mapKey: '', places: [] };
    // Displays used to keep their own choice; it's in /setup now.
    try { localStorage.removeItem('hub.radarMap'); } catch { /* storage unavailable */ }

    const poll = async (): Promise<Outcome> => {
      try {
        const data = await getJson<AircraftResponse>(`/api/aircraft?routes=${FEATURED}&${skyQuery(state.home)}`);
        // Never swap newer positions for older ones (a stale answer can be older than what we show).
        if (state.data && data.fetchedAt <= state.data.fetchedAt) {
          renderPanel(panel, config, state);
          return 'failed';
        }
        const seen = new Set<string>();
        for (const a of data.aircraft) {
          seen.add(a.hex);
          const t = state.trails.get(a.hex) ?? [];
          t.push(offsetNm(state.home, a.lat, a.lon));
          state.trails.set(a.hex, t.slice(-TRAIL_POINTS));
        }
        for (const hex of [...state.trails.keys()]) if (!seen.has(hex)) { state.trails.delete(hex); state.placement.delete(hex); }
        Object.assign(state, { data, receivedAt: Date.now(), error: null, pingAt: performance.now() });
        if (!data.stale) remember('aircraft', state.home, data);
        renderPanel(panel, config, state);
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
        Object.assign(state, { home, data: recall<AircraftResponse>('aircraft', home), error: null });
        state.trails.clear();
        state.placement.clear();
        renderPanel(panel, config, state);
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
    if (retarget && nextPlace(currentConfig!)) retarget();
  },
  unmount() {
    refresher?.stop();
    refresher = undefined;
    if (frame) cancelAnimationFrame(frame);
    retarget = undefined;
  },
};
