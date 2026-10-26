import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import { sunLongitude } from '../../shared/astro';
import type { HubConfig, IssPass, IssResponse } from '../../shared/types';
import { getJson } from '../api';
import { skyHome, skyQuery, type SkyHome } from '../location';
import { BLUE_MARBLE } from '../mapTiles';
import { mapView, pathThrough, type MapView } from '../mapView';
import { h, type Screen } from '../screen';

// The Space Station, live: where it is over the world right now (worked out on the display from
// its orbit, second by second), the path it has flown and will fly, day and night on the Earth
// below, and beside the map who's aboard and when it next passes over visibly.

const REFRESH_MS = 30 * 60_000;
const TRACK_MS = 60_000;
const SVG = 'http://www.w3.org/2000/svg';
const MIN = 60_000;
/** The station: a body between two solar arrays. */
const STATION = 'M1 9h7v6H1zM16 9h7v6h-7zM8 11.4h8v1.2H8zM10 8.5h4v7h-4z';

let refresh: number | undefined;
/** The second-by-second position and the minute-by-minute track, restarted with each new orbit. */
let live: number[] = [];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

interface Fix { lat: number; lon: number; altKm: number; speedKmh: number }

function where(sat: SatRec, t: number): Fix | null {
  const date = new Date(t);
  const pv = propagate(sat, date);
  if (!pv || typeof pv.position === 'boolean' || typeof pv.velocity === 'boolean') return null;
  const g = eciToGeodetic(pv.position, gstime(date));
  const v = pv.velocity;
  return { lat: degreesLat(g.latitude), lon: degreesLong(g.longitude), altKm: g.height, speedKmh: Math.hypot(v.x, v.y, v.z) * 3600 };
}

/** Where the sun is overhead: the latitude is its declination. */
function subsolar(t: number) {
  const L = sunLongitude(t / 86_400_000 - 10957.5);
  const ε = (23.4397 * Math.PI) / 180;
  const dec = Math.asin(Math.sin(ε) * Math.sin(L));
  const ra = Math.atan2(Math.cos(ε) * Math.sin(L), Math.cos(L));
  const lon = ((((ra - gstime(new Date(t))) * 180) / Math.PI + 540) % 360) - 180;
  return { dec, lon };
}

/** The night side of the Earth, as a path over the map. */
function nightPath(view: MapView, centreLon: number, t: number): string {
  const sun = subsolar(t);
  // Exactly at an equinox the line is a meridian; a hair of declination keeps the maths finite.
  const dec = Math.abs(sun.dec) < 1e-3 ? 1e-3 : sun.dec;
  let d = '';
  for (let x = -4; x <= view.width + 4; x += 4) {
    const lon = centreLon + ((x - view.width / 2) / view.worldPx) * 360;
    const lat = (Math.atan(-Math.cos(((lon - sun.lon) * Math.PI) / 180) / Math.tan(dec)) * 180) / Math.PI;
    d += `${d ? 'L' : 'M'}${x} ${view.project(lat, lon).y.toFixed(1)}`;
  }
  // North of the sun (its declination positive) the night lies south of the line, and vice versa.
  const edge = dec > 0 ? view.height + 4 : -4;
  return `${d}L${view.width + 4} ${edge}L-4 ${edge}Z`;
}

const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;
const num = (n: number) => Math.round(n).toLocaleString('en-GB');

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function passText(p: IssPass, tz: string) {
  const t = new Date(p.start);
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const now = new Date();
  const day = dayKey(t) === dayKey(now) ? 'Today' : dayKey(t) === dayKey(new Date(now.getTime() + 86_400_000)) ? 'Tomorrow'
    : new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: tz }).format(t);
  const at = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(t);
  const mins = Math.max(1, Math.round((Date.parse(p.end) - Date.parse(p.start)) / MIN));
  const height = p.maxElev >= 60 ? 'almost overhead' : p.maxElev >= 30 ? 'high' : 'low';
  return [`${day} ${at}`, `${mins} min, ${height}, ${p.from} to ${p.to}`];
}

function render(el: HTMLElement, config: HubConfig, d: IssResponse, home: SkyHome) {
  const sat = twoline2satrec(...d.tle);
  const box = h('div', 'wx-radar iss-map');
  const side = h('section', 'iss-panel');
  el.replaceChildren(box, side);

  // The panel: where it is now (updated every second), the next pass, and the crew.
  side.append(h('h1', 'iss-title', 'Space Station'));
  const over = h('p', 'iss-over');
  const stats = h('dl', 'iss-stats');
  const stat = (label: string) => {
    const dd = h('dd');
    const box = h('div');
    box.append(h('dt', undefined, label), dd);
    stats.append(box);
    return dd;
  };
  const alt = stat('Altitude'), speed = stat('Speed'), away = stat('From you');
  side.append(over, stats);
  if (d.passes) {
    const next = h('div', 'iss-next');
    next.append(h('h2', undefined, 'Next visible pass'));
    if (d.passes.length) {
      const [when, how] = passText(d.passes[0], config.timezone);
      next.append(h('b', undefined, when), h('span', undefined, how));
    } else next.append(h('span', undefined, 'None in the next three days'));
    side.append(next);
  }
  if (d.crew.length) {
    const crew = h('div', 'iss-crew');
    crew.append(h('h2', undefined, `${d.crew.length} aboard${d.expedition ? ` · Expedition ${d.expedition}` : ''}`));
    const list = h('ul');
    for (const c of d.crew) {
      const li = h('li');
      li.append(h('b', undefined, c.name), h('span', undefined, `${c.agency} · ${c.role}`));
      list.append(li);
    }
    crew.append(list);
    side.append(crew);
  }

  // The map: the whole world, centred on home's longitude so home's side of it is in the middle.
  const { width, height } = box.getBoundingClientRect();
  if (!width || !height) return;
  const zoom = Math.log2(Math.max(width, height) / 256);
  const worldPx = 256 * 2 ** zoom;
  const view = mapView(BLUE_MARBLE, 'satellite', worldPx > height + 1 ? 20 : 0, home.lon, zoom, width, height);
  const svg = svgEl('svg', { class: 'iss-overlay', viewBox: `0 0 ${width} ${height}`, width, height });
  const night = svgEl('path', { class: 'iss-night' });
  const flown = svgEl('path', { class: 'iss-track-flown' });
  const ahead = svgEl('path', { class: 'iss-track-ahead' });
  const me = view.project(home.lat, home.lon);
  const homeDot = svgEl('circle', { cx: me.x.toFixed(1), cy: me.y.toFixed(1), r: 5, class: 'iss-home' });
  const station = svgEl('g', { class: 'iss-station' });
  station.append(svgEl('circle', { r: 22, class: 'iss-glow' }), svgEl('path', { d: STATION, transform: 'scale(1.4) translate(-12 -12)' }));
  svg.append(night, flown, ahead, homeDot, station);
  box.append(view.el, svg, h('span', 'map-credit', BLUE_MARBLE.credit));

  const track = () => {
    const now = Date.now();
    const points = (from: number, to: number) => {
      const out: Array<{ lat: number; lon: number }> = [];
      for (let t = from; t <= to; t += MIN) { const f = where(sat, t); if (f) out.push(f); }
      return out;
    };
    flown.setAttribute('d', pathThrough(view, points(now - 45 * MIN, now)));
    ahead.setAttribute('d', pathThrough(view, points(now, now + 90 * MIN)));
    night.setAttribute('d', nightPath(view, home.lon, now));
  };
  const tick = () => {
    const f = where(sat, Date.now());
    if (!f) return;
    const p = view.project(f.lat, f.lon);
    station.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    over.textContent = `Over ${deg(f.lat, 'N', 'S')}, ${deg(f.lon, 'E', 'W')}`;
    alt.textContent = `${num(f.altKm)} km`;
    speed.textContent = `${num(f.speedKmh)} km/h`;
    away.textContent = `${num(distanceKm(home, f))} km`;
  };
  track();
  tick();
  live.push(window.setInterval(track, TRACK_MS), window.setInterval(tick, 1000));
}

export const issScreen: Screen = {
  id: 'iss',
  title: 'Space Station',
  durationSec: 45,
  mount(el: HTMLElement, config: HubConfig) {
    el.append(h('p', 'wx-loading', 'Finding the Space Station…'));
    const load = async () => {
      try {
        const home = await skyHome(config);
        const d = await getJson<IssResponse>(`/api/iss?${skyQuery(home)}`);
        live.forEach(clearInterval);
        live = [];
        render(el, config, d, home);
      } catch {
        if (!el.querySelector('.iss-map')) el.replaceChildren(h('p', 'wx-loading', 'The Space Station’s orbit isn’t available right now.'));
      }
    };
    load();
    refresh = window.setInterval(load, REFRESH_MS);
  },
  unmount() {
    clearInterval(refresh);
    live.forEach(clearInterval);
    live = [];
  },
};
