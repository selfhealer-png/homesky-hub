import type { Aircraft, BoardTheme, HubConfig, OverheadResponse, RouteInfo } from '../../shared/types';
import { getJson } from '../api';
import { FlapRow, setFlapMotion, type FlapMotion } from '../flap';
import { skyHome, skyQuery } from '../location';
import { h, type Screen } from '../screen';

const POLL_MS = 10_000;
const MIN_HOLD_MS = 30000; // stay on one aircraft at least this long
const THEMES: BoardTheme[] = ['splitflap', 'led', 'minimal'];
const MOTION: Record<BoardTheme, FlapMotion> = { splitflap: 'flip', led: 'scramble', minimal: 'fade' };
const THEME_KEY = 'hub.boardTheme';

let pollTimer: number | undefined;
let root: HTMLElement | undefined;
let theme: BoardTheme = 'splitflap';

function storedTheme(fallback: BoardTheme): BoardTheme {
  try {
    const t = localStorage.getItem(THEME_KEY) as BoardTheme | null;
    return t && THEMES.includes(t) ? t : fallback;
  } catch {
    return fallback;
  }
}

function applyTheme(t: BoardTheme) {
  theme = t;
  setFlapMotion(MOTION[t]);
  root?.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: theme just isn't remembered */ }
}

const km = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-GB'));

function altitude(a: Aircraft): string {
  if (a.altFt == null) return 'GND';
  const trend = a.verticalRateFpm == null || Math.abs(a.verticalRateFpm) < 300 ? '' : a.verticalRateFpm > 0 ? '↗' : '↘';
  return a.altFt.toLocaleString('en-GB') + trend;
}

function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function airportCode(ap: RouteInfo['origin']) {
  return ap.iata || ap.icao;
}

function render(ui: BoardUi, data: OverheadResponse) {
  const a = data.aircraft;
  const r = data.route;
  ui.el.classList.toggle('empty', !a);
  ui.el.classList.toggle('emergency', !!a?.emergency);

  if (!a) {
    ui.airline.set('NO AIRCRAFT NEARBY', 'center');
    ui.callsign.set('CLEAR', 'center');
    ui.route.set('', 'center');
    ui.cities.set('WATCHING THE SKY', 'center');
    ui.alt.set(''); ui.spd.set(''); ui.hdg.set(''); ui.dist.set('');
    ui.progress.hidden = true;
    ui.footer.textContent = `${data.candidates} aircraft in range · via ${data.source}`;
    return;
  }

  ui.airline.set(a.emergency ? `SQUAWK ${a.squawk ?? 'EMERGENCY'}` : r?.airline?.name ?? a.type ?? 'AIRCRAFT', 'center');
  ui.callsign.set(a.callsign ?? a.registration ?? a.hex.toUpperCase(), 'center');
  if (r) {
    ui.route.set(`${airportCode(r.origin)} → ${airportCode(r.destination)}`, 'center');
    ui.cities.set(`${r.origin.city} → ${r.destination.city}`, 'center');
  } else {
    ui.route.set([a.type, a.registration].filter(Boolean).join(' '), 'center');
    ui.cities.set('ROUTE UNKNOWN', 'center');
  }
  ui.alt.set(altitude(a), 'right');
  ui.spd.set(a.groundSpeedKt != null ? String(Math.round(a.groundSpeedKt)) : '-', 'right');
  ui.hdg.set(a.trackDeg != null ? `${Math.round(a.trackDeg)}°${compass(a.trackDeg)}` : '-', 'right');
  ui.dist.set(km(a.distanceNm * 1.852), 'right');

  ui.progress.hidden = !r;
  if (r) {
    ui.from.textContent = airportCode(r.origin);
    ui.to.textContent = airportCode(r.destination);
    ui.bar.style.setProperty('--progress', String(r.progress));
  }

  const facts = r
    ? [`${km(r.flownKm)} km from ${airportCode(r.origin)}`, `${km(r.remainingKm)} km to ${airportCode(r.destination)}`]
    : [];
  if (r && a.type) facts.push(a.type);
  if (r && a.registration) facts.push(a.registration);
  ui.footer.textContent = facts.join(' · ');
}

interface BoardUi {
  el: HTMLElement;
  airline: FlapRow; callsign: FlapRow; route: FlapRow; cities: FlapRow;
  alt: FlapRow; spd: FlapRow; hdg: FlapRow; dist: FlapRow;
  progress: HTMLElement; from: HTMLElement; to: HTMLElement; bar: HTMLElement;
  footer: HTMLElement;
}

function build(el: HTMLElement): BoardUi {
  const stat = (label: string, unit: string, row: FlapRow) => {
    const box = h('div', 'stat');
    const cap = h('div', 'stat-label');
    cap.append(h('span', undefined, label), h('span', 'unit', unit));
    box.append(cap, row.el);
    return box;
  };

  const ui: BoardUi = {
    el,
    airline: new FlapRow(22, 'sm'),
    callsign: new FlapRow(8, 'xl'),
    route: new FlapRow(11, 'lg'),
    cities: new FlapRow(30, 'sm'),
    alt: new FlapRow(7, 'md'),
    spd: new FlapRow(3, 'md'),
    hdg: new FlapRow(6, 'md'),
    dist: new FlapRow(5, 'md'),
    progress: h('div', 'progress'),
    from: h('span', 'ap'),
    to: h('span', 'ap'),
    bar: h('div', 'bar'),
    footer: h('div', 'footer'),
  };
  // An SVG rather than the ✈ character, which many systems draw as a colour emoji.
  const plane = h('span', 'plane');
  plane.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" transform="rotate(90 12 12)"/></svg>';
  ui.bar.append(plane);
  ui.progress.append(ui.from, ui.bar, ui.to);

  const stats = h('div', 'stats');
  stats.append(stat('ALT', 'ft', ui.alt), stat('SPD', 'kt', ui.spd), stat('HDG', '', ui.hdg), stat('DIST', 'km', ui.dist));

  const board = h('div', 'board');
  board.append(ui.airline.el, ui.callsign.el, ui.route.el, ui.cities.el, stats, ui.progress, ui.footer);
  el.append(board);
  return ui;
}

export const boardScreen: Screen = {
  id: 'board',
  title: 'Overhead',
  durationSec: 60,
  mount(el: HTMLElement, config: HubConfig) {
    root = el;
    applyTheme(storedTheme(config.boardTheme));
    const ui = build(el);

    let held: string | null = null;
    let heldSince = 0;
    const poll = async () => {
      const hold = held && Date.now() - heldSince < MIN_HOLD_MS ? `&hold=${encodeURIComponent(held)}` : '';
      try {
        const data = await getJson<OverheadResponse>(`/api/overhead?${skyQuery(await skyHome(config))}${hold}`);
        const hex = data.aircraft?.hex ?? null;
        if (hex !== held) { held = hex; heldSince = Date.now(); }
        render(ui, data);
      } catch {
        // Keep the last board on screen; a single refused update isn't worth mentioning.
        if (!held) ui.footer.textContent = 'Looking for aircraft…';
      }
    };
    poll();
    pollTimer = window.setInterval(poll, POLL_MS);
  },
  onCenterTap() {
    applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
  },
  unmount() {
    clearInterval(pollTimer);
    root = undefined;
  },
};
