import type { Aircraft, HubConfig, RouteInfo, TrackResponse } from '../../shared/types';
import { minutesToGo } from '../../shared/arrivals';
import { typeName } from '../../shared/notable';
import { getJson } from '../api';
import { skyHome, skyQuery, type SkyHome } from '../location';
import { TILE_SOURCES } from '../mapTiles';
import { fitView, greatCircle, mapView, pathThrough, type MapView } from '../mapView';
import { h, type Screen } from '../screen';

// The Flight tracker: one flight, chosen in /setup, followed wherever it is in the world. A map
// of its route with the plane on it, and beside it where it's going, how far along it is, and
// how high and fast. When it isn't flying, the screen says so and when it was last seen.

const REFRESH_MS = 20_000;
const SVG = 'http://www.w3.org/2000/svg';
const PLANE = 'M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5Z';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

let timer: number | undefined;
/** The followed plane while it's flying, for "About this plane" in the menu. */
let followed: Aircraft | null = null;
/** The map's tiles, kept between refreshes while the route and the box stay the same. */
let tiles: { key: string; view: MapView } | undefined;

const num = (n: number) => Math.round(n).toLocaleString('en-GB');
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

function duration(min: number) {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const hrs = Math.floor(min / 60), mins = Math.round(min % 60);
  return mins ? `${hrs} h ${mins} min` : `${hrs} h`;
}

function ago(at: number) {
  const min = (Date.now() - at) / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))} minutes ago`;
  if (min < 36 * 60) return `${Math.round(min / 60)} hours ago`;
  return `${Math.round(min / 1440)} days ago`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The route (flown solid, the rest dashed), the airports, the plane, and home if it's in view. */
function drawMap(box: HTMLElement, config: HubConfig, a: Aircraft, route: RouteInfo | null, home: SkyHome) {
  const { width, height } = box.getBoundingClientRect();
  if (!width || !height) return;
  const kind = config.radarMap === 'satellite' ? 'satellite' : 'map';
  const source = TILE_SOURCES[kind];
  const ends = route ? [route.origin, route.destination] : [];
  // With a route the view fits both airports and stays put; without, it follows the plane.
  const key = route ? `${kind}:${route.origin.icao}:${route.destination.icao}:${width}x${height}` : '';
  if (!key || tiles?.key !== key) {
    const fit = ends.length ? fitView([...ends, a], width, height, 56, 9) : { lat: a.lat, lon: a.lon, zoom: 8 };
    tiles = { key, view: mapView(source, kind, fit.lat, fit.lon, fit.zoom, width, height) };
  }
  const { view } = tiles;

  const svg = svgEl('svg', { class: 'ft-overlay', viewBox: `0 0 ${width} ${height}`, width, height });
  if (route) {
    const before = greatCircle(route.origin, a, 48), after = greatCircle(a, route.destination, 48);
    svg.append(
      svgEl('path', { d: pathThrough(view, after), class: 'ft-route-ahead' }),
      svgEl('path', { d: pathThrough(view, before), class: 'ft-route-flown' }),
    );
    for (const end of ends) {
      const p = view.project(end.lat, end.lon);
      const g = svgEl('g', { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})` });
      const label = svgEl('text', { class: 'ft-code', y: -14, 'text-anchor': 'middle' });
      label.textContent = end.iata || end.icao;
      g.append(svgEl('circle', { r: 6, class: 'ft-airport' }), label);
      svg.append(g);
    }
  }
  const me = view.project(home.lat, home.lon);
  if (me.x > 0 && me.x < width && me.y > 0 && me.y < height) {
    svg.append(svgEl('circle', { cx: me.x.toFixed(1), cy: me.y.toFixed(1), r: 5, class: 'ft-home' }));
  }
  const p = view.project(a.lat, a.lon);
  const plane = svgEl('g', { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.trackDeg ?? 0}) scale(1.6) translate(-12 -12)`, class: 'ft-plane' });
  plane.append(svgEl('path', { d: PLANE }));
  svg.append(plane);

  const credit = h('span', 'map-credit', source.credit);
  box.replaceChildren(view.el, svg, credit);
}

function stat(label: string, value: string) {
  const d = h('div');
  d.append(h('dt', undefined, label), h('dd', undefined, value));
  return d;
}

function panel(d: TrackResponse, a: Aircraft) {
  const r = d.route;
  const side = h('section', 'ft-panel');
  side.append(h('p', 'ft-kicker', 'Following'));
  side.append(h('h1', 'ft-flight', r?.flightNumber ?? a.callsign ?? a.registration ?? d.query));
  const who = [r?.airline?.name, typeName(a.desc) ?? a.type, a.registration].filter(Boolean).join(' · ');
  if (who) side.append(h('p', 'ft-airline', who));

  if (r) {
    const leg = h('div', 'ft-leg');
    leg.append(h('b', undefined, `${r.origin.iata || r.origin.icao} → ${r.destination.iata || r.destination.icao}`),
      h('span', undefined, `${r.origin.city} to ${r.destination.city}`));
    side.append(leg);
    const bar = h('div', 'ft-progress');
    bar.style.setProperty('--p', `${Math.round(r.progress * 100)}%`);
    side.append(bar);
    // Roughly, so it's "about".
    const togo = minutesToGo(r.remainingKm, a);
    const eta = togo !== null ? `, lands in about ${duration(togo)}` : '';
    side.append(h('p', 'ft-togo', `${num(r.remainingKm)} km to go${eta}`));
  } else if (a.altFt !== null) {
    side.append(h('p', 'ft-togo', 'Route not known'));
  }

  const stats = h('dl', 'ft-stats');
  stats.append(stat('Altitude', a.altFt === null ? 'On the ground' : `${num(a.altFt)} ft`));
  if (a.groundSpeedKt !== null) stats.append(stat('Speed', `${num(a.groundSpeedKt * 1.852)} km/h`));
  if (a.trackDeg !== null) stats.append(stat('Heading', `${Math.round(a.trackDeg)}° ${compass(a.trackDeg)}`));
  if (Number.isFinite(a.distanceNm)) stats.append(stat('From you', `${num(a.distanceNm * 1.852)} km ${compass(a.bearingDeg)}`));
  side.append(stats);
  return side;
}

function render(el: HTMLElement, config: HubConfig, d: TrackResponse, home: SkyHome) {
  el.classList.toggle('ft-idle', !d.aircraft);
  if (!d.aircraft) {
    const box = h('section', 'ft-waiting');
    box.append(svgPlane(), h('h1', undefined, `${d.query} isn’t flying right now`));
    const seen = d.lastSeen ? `Last seen ${ago(d.lastSeen.at)}${d.lastSeen.callsign && d.lastSeen.callsign !== d.query ? ` as ${d.lastSeen.callsign}` : ''}. ` : '';
    box.append(h('p', undefined, `${seen}It shows up here as soon as it’s in the air.`));
    el.replaceChildren(box);
    return;
  }
  const map = el.querySelector<HTMLElement>('.ft-map') ?? h('div', 'wx-radar ft-map');
  el.replaceChildren(map, panel(d, d.aircraft));
  drawMap(map, config, d.aircraft, d.route, home);
}

function svgPlane() {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'ft-waiting-icon', 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d: PLANE }));
  return svg;
}

export const flightScreen: Screen = {
  id: 'flight',
  title: 'Flight tracker',
  isAvailable: config => !!config.follow,
  mount(el: HTMLElement, config: HubConfig) {
    el.append(h('p', 'wx-loading', `Looking for ${config.follow}…`));
    let shown = false;
    const load = async () => {
      try {
        const home = await skyHome(config);
        const data = await getJson<TrackResponse>(`/api/track?${skyQuery(home)}`);
        followed = data.aircraft;
        render(el, config, data, home);
        shown = true;
      } catch {
        // Keep the last good view; only say so if there's nothing on screen yet.
        if (!shown) el.replaceChildren(h('p', 'wx-loading', 'The flight tracker can’t reach the flight data right now.'));
      }
    };
    load();
    timer = window.setInterval(load, REFRESH_MS);
  },
  currentAircraft: () => followed,
  unmount() {
    clearInterval(timer);
    followed = null;
    tiles = undefined;
  },
};
