import type { SavedAirport } from '../../shared/settings';
import type { AirportBoardResponse, AirportFlight, HubConfig } from '../../shared/types';
import { getJson } from '../api';
import { FlapRow, setFlapMotion } from '../flap';
import { ageLabel, isStale, recall, Refresher, remember, watchAge, type Outcome } from '../skyCache';
import { h, setCaption, type Screen } from '../screen';
import { MOTION, storedTheme } from './board';

// An airport arrivals board, split-flap style, for each airport chosen in /setup. Each visit
// shows the next airport's arrivals; a tap in the middle turns to its departures, then on to
// the next airport. Rows are flights already in the air (or taxiing) within 100 nm: the ETA is
// worked out from where the plane is, not taken from a timetable.

const ROWS = 8;
/** Upright, the board is as wide as it can be, so the extra height goes to more flights. */
const PORTRAIT_ROWS = 14;
const rowCount = () => (window.matchMedia('(orientation: portrait)').matches ? PORTRAIT_ROWS : ROWS);
type Kind = 'arrivals' | 'departures';

interface Column { key: string; label: string; width: number; align?: 'left' | 'right' }
const COLUMNS: Record<Kind, Column[]> = {
  arrivals: [
    { key: 'city', label: 'FROM', width: 12 },
    { key: 'flight', label: 'FLIGHT', width: 7 },
    { key: 'type', label: 'TYPE', width: 4 },
    { key: 'alt', label: 'ALT FT', width: 6, align: 'right' },
    { key: 'time', label: 'ETA', width: 5 },
    { key: 'status', label: 'STATUS', width: 10 },
  ],
  departures: [
    { key: 'city', label: 'TO', width: 12 },
    { key: 'flight', label: 'FLIGHT', width: 7 },
    { key: 'type', label: 'TYPE', width: 4 },
    { key: 'alt', label: 'ALT FT', width: 6, align: 'right' },
    { key: 'time', label: 'KM', width: 5, align: 'right' },
    { key: 'status', label: 'STATUS', width: 10 },
  ],
};

/** Each visit moves on one airport; a tap moves on one view (arrivals, departures, next airport…). */
let view = -1;
let refresher: Refresher | undefined;
let rebuild: (() => void) | undefined;
let stopAge: (() => void) | undefined;
/** An arrival whose estimate passed this long ago has landed or gone elsewhere: it leaves the board. */
const PASSED_MS = 2 * 60_000;
const kindName = (kind: Kind) => (kind === 'arrivals' ? 'Arrivals' : 'Departures');

const views = (config: HubConfig) => config.airports.flatMap(a => (['arrivals', 'departures'] as Kind[]).map(kind => ({ airport: a, kind })));

function cells(f: AirportFlight, kind: Kind, tz: string, fetchedAt: number): Record<string, string> {
  const time = kind === 'arrivals'
    ? f.status === 'landed' ? '' : isStale(fetchedAt) ? '—' : new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(fetchedAt + (f.etaMin ?? 0) * 60_000))
    : f.altFt === null ? '' : String(Math.round(f.distanceNm * 1.852));
  return {
    city: f.city,
    flight: f.flight.replace(/^([A-Z0-9]{2})(\d)/, '$1 $2'),
    type: f.type ?? '',
    alt: f.altFt === null ? 'GND' : f.altFt.toLocaleString('en-GB'),
    time,
    status: f.status,
  };
}

interface BoardUi {
  el: HTMLElement;
  title: HTMLElement; place: FlapRow; code: HTMLElement;
  rows: Array<Record<string, FlapRow>>;
  labels: HTMLElement[];
  footer: HTMLElement;
}

function build(el: HTMLElement): BoardUi {
  const board = h('div', 'ab');
  const head = h('div', 'ab-head');
  const title = h('div', 'ab-title');
  const place = new FlapRow(12, 'md');
  const code = h('span', 'ab-code');
  head.append(title, h('div', 'ab-place'));
  head.lastElementChild!.append(place.el, code);

  const grid = h('div', 'ab-grid');
  const labels = COLUMNS.arrivals.map(c => h('div', `ab-label ab-col-${c.key}${c.align === 'right' ? ' right' : ''}`, c.label));
  grid.append(...labels);
  const rows = Array.from({ length: rowCount() }, () => {
    const row: Record<string, FlapRow> = {};
    for (const c of COLUMNS.arrivals) {
      row[c.key] = new FlapRow(c.width, 'sm');
      row[c.key].el.classList.add(`ab-col-${c.key}`);
      grid.append(row[c.key].el);
    }
    return row;
  });
  const footer = h('div', 'footer');
  board.append(head, grid, footer);
  el.append(board);
  return { el, title, place, code, rows, labels, footer };
}

function render(ui: BoardUi, data: AirportBoardResponse, kind: Kind, config: HubConfig) {
  const columns = COLUMNS[kind];
  const now = Date.now();
  const flights = kind === 'arrivals'
    ? data.arrivals.filter(f => f.status === 'landed' || f.etaMin === null || data.fetchedAt + f.etaMin * 60_000 > now - PASSED_MS)
    : data.departures;
  ui.title.replaceChildren(planeIcon(kind), h('span', undefined, kindName(kind)));
  setCaption(`${kindName(kind)} · ${data.airport.city}`);
  ui.place.set(data.airport.city, 'right');
  ui.code.textContent = data.airport.iata || data.airport.icao;
  columns.forEach((c, i) => { ui.labels[i].textContent = c.label; });

  ui.rows.forEach((row, n) => {
    const f = flights[n];
    const text = f ? cells(f, kind, config.timezone, data.fetchedAt) : null;
    for (const c of columns) row[c.key].set(text?.[c.key] ?? '', c.align ?? 'left');
    row.status.el.dataset.status = f?.status ?? '';
  });

  const shown = ui.rows.length;
  const more = flights.length > shown ? `+${flights.length - shown} more` : '';
  const what = kind === 'arrivals'
    ? flights.length ? `${flights.length} inbound within ${data.radiusNm} nm` : `No arrivals within ${data.radiusNm} nm just now`
    : flights.length ? `${flights.length} outbound within ${data.radiusNm} nm` : 'No departures seen just now';
  const note = kind === 'arrivals' && flights.length ? 'times estimated from position and speed' : '';
  ui.footer.textContent = [what, more, note, `via ${data.source}`, ageLabel(data.fetchedAt)].filter(Boolean).join(' · ');
}

function planeIcon(kind: Kind) {
  const s = h('span', 'ab-icon');
  // Landing: nose down to the right; departing: nose up.
  const rotate = kind === 'arrivals' ? 125 : 55;
  s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" transform="rotate(${rotate} 12 12)"/></svg>`;
  return s;
}

/** The remembered-answer cache is keyed by a place; an airport is one. */
const placeOf = (a: SavedAirport) => ({ lat: a.lat, lon: a.lon, name: a.icao });

export const airportScreen: Screen = {
  id: 'airport',
  title: 'Airports',
  durationSec: 60,
  isAvailable: config => config.airports.length > 0,
  mount(el: HTMLElement, config: HubConfig) {
    const theme = storedTheme(config.boardTheme);
    setFlapMotion(MOTION[theme]);
    el.setAttribute('data-theme', theme);
    const ui = build(el);

    // Each visit starts on the next airport's arrivals.
    const all = views(config);
    view = view < 0 ? 0 : (Math.floor(view / 2) + 1) * 2 % all.length;
    let shown: AirportBoardResponse | null = null;

    const current = () => all[view % all.length];
    const show = () => {
      const { airport, kind } = current();
      if (shown?.airport.icao === airport.icao) render(ui, shown, kind, config);
    };

    let generation = 0;
    const poll = async (): Promise<Outcome> => {
      const mine = generation;
      const { airport } = current();
      try {
        const data = await getJson<AirportBoardResponse>(`/api/airport?code=${encodeURIComponent(airport.icao)}`);
        if (mine !== generation) return 'failed';
        shown = data;
        show();
        age.check();
        remember('airport', placeOf(airport), data);
        return data.arrivals.length || data.departures.length ? 'found' : 'empty';
      } catch {
        if (!shown) ui.footer.textContent = 'Looking for flights…';
        return 'failed';
      }
    };

    const age = watchAge(el, config.timezone, () => shown?.fetchedAt ?? null, () => show());
    stopAge = age.stop;

    rebuild = () => {
      generation++;
      const { airport, kind } = current();
      el.classList.toggle('departures', kind === 'departures');
      if (shown?.airport.icao !== airport.icao) {
        shown = recall<AirportBoardResponse>('airport', placeOf(airport));
        if (!shown) {
          // Nothing known yet: name the board while the first answer loads.
          ui.title.replaceChildren(planeIcon(kind), h('span', undefined, kindName(kind)));
          ui.place.set(airport.city, 'right');
          ui.code.textContent = airport.iata || airport.icao;
          ui.rows.forEach(row => Object.values(row).forEach(r => r.set('')));
          ui.footer.textContent = 'Looking for flights…';
        }
      }
      show();
      age.check();
      setCaption(`${kindName(kind)} · ${airport.city}`);
      refresher?.stop();
      refresher = new Refresher(poll);
      refresher.now();
    };
    rebuild();
  },
  onCenterTap() {
    if (!rebuild) return;
    view++;
    rebuild();
    return document.querySelector('#caption')?.textContent ?? undefined;
  },
  unmount() {
    refresher?.stop();
    refresher = undefined;
    rebuild = undefined;
    stopAge?.();
    stopAge = undefined;
  },
};
