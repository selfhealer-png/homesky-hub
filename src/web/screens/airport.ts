import type { SavedAirport } from '../../shared/settings';
import type { AirportBoardResponse, AirportFlight, HubConfig } from '../../shared/types';
import { getJson } from '../api';
import { FlapRow, setFlapMotion } from '../flap';
import { ageLabel, isStale, recall, Refresher, remember, watchAge, type Outcome } from '../skyCache';
import { h, type Screen } from '../screen';
import { MOTION, storedTheme } from './board';

// The airport board, split-flap style, for the airport chosen in /setup: arrivals above,
// departures below, as one board. Rows are flights already in the air (or taxiing) within
// 100 nm: the ETA is worked out from where the plane is, not taken from a timetable.

/** Rows in each half of the board; upright, the board is narrower and taller, so it gets more. */
const ROWS = 6;
const PORTRAIT_ROWS = 10;
const rowCount = () => (window.matchMedia('(orientation: portrait)').matches ? PORTRAIT_ROWS : ROWS);
type Kind = 'arrivals' | 'departures';
const KINDS: Kind[] = ['arrivals', 'departures'];

interface Column { key: string; label: string; width: number; align?: 'left' | 'right' }
// The same widths in both halves, so their columns line up.
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

let refresher: Refresher | undefined;
let stopAge: (() => void) | undefined;
/** An arrival whose estimate passed this long ago has landed or gone elsewhere: it leaves the board. */
const PASSED_MS = 2 * 60_000;
const kindName = (kind: Kind) => (kind === 'arrivals' ? 'Arrivals' : 'Departures');

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

type Rows = Array<Record<string, FlapRow>>;

interface BoardUi {
  place: FlapRow; code: HTMLElement;
  rows: Record<Kind, Rows>;
  footer: HTMLElement;
}

function build(el: HTMLElement): BoardUi {
  const board = h('div', 'ab');
  const head = h('div', 'ab-head');
  const place = new FlapRow(12, 'md');
  const code = h('span', 'ab-code');
  head.append(h('div', 'ab-place'));
  head.lastElementChild!.append(place.el, code);
  board.append(head);

  const rows = {} as Record<Kind, Rows>;
  for (const kind of KINDS) {
    const section = h('section', `ab-section ab-${kind}`);
    const title = h('div', 'ab-title');
    title.append(planeIcon(kind), h('span', undefined, kindName(kind)));
    const grid = h('div', 'ab-grid');
    grid.append(...COLUMNS[kind].map(c => h('div', `ab-label ab-col-${c.key}${c.align === 'right' ? ' right' : ''}`, c.label)));
    rows[kind] = Array.from({ length: rowCount() }, () => {
      const row: Record<string, FlapRow> = {};
      for (const c of COLUMNS[kind]) {
        row[c.key] = new FlapRow(c.width, 'sm');
        row[c.key].el.classList.add(`ab-col-${c.key}`);
        grid.append(row[c.key].el);
      }
      return row;
    });
    section.append(title, grid);
    board.append(section);
  }

  const footer = h('div', 'footer');
  board.append(footer);
  el.append(board);
  return { place, code, rows, footer };
}

function showPlace(ui: BoardUi, airport: { city: string; iata: string; icao: string }) {
  ui.place.set(airport.city);
  ui.code.textContent = airport.iata || airport.icao;
}

function render(ui: BoardUi, data: AirportBoardResponse, config: HubConfig) {
  const now = Date.now();
  const lists: Record<Kind, AirportFlight[]> = {
    arrivals: data.arrivals.filter(f => f.status === 'landed' || f.etaMin === null || data.fetchedAt + f.etaMin * 60_000 > now - PASSED_MS),
    departures: data.departures,
  };
  showPlace(ui, data.airport);
  for (const kind of KINDS) {
    ui.rows[kind].forEach((row, n) => {
      const f = lists[kind][n];
      const text = f ? cells(f, kind, config.timezone, data.fetchedAt) : null;
      for (const c of COLUMNS[kind]) row[c.key].set(text?.[c.key] ?? '', c.align ?? 'left');
      row.status.el.dataset.status = f?.status ?? '';
    });
  }

  const count = (kind: Kind, word: string) => {
    const n = lists[kind].length, shown = ui.rows[kind].length;
    return `${n} ${word}${n > shown ? ` (+${n - shown} more)` : ''}`;
  };
  const what = `${count('arrivals', 'inbound')} · ${count('departures', 'outbound')} within ${data.radiusNm} nm`;
  const note = lists.arrivals.length ? 'arrival times estimated from position and speed' : '';
  ui.footer.textContent = [what, note, `via ${data.source}`, ageLabel(data.fetchedAt)].filter(Boolean).join(' · ');
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
  title: 'Airport',
  durationSec: 60,
  isAvailable: config => config.airports.length > 0,
  mount(el: HTMLElement, config: HubConfig) {
    const theme = storedTheme(config.boardTheme);
    setFlapMotion(MOTION[theme]);
    el.setAttribute('data-theme', theme);
    const ui = build(el);
    const airport = config.airports[0];

    // The last board seen, straight away, while a fresh one loads.
    let shown = recall<AirportBoardResponse>('airport', placeOf(airport));
    if (shown?.airport.icao !== airport.icao) shown = null;
    if (shown) render(ui, shown, config);
    else {
      showPlace(ui, airport);
      ui.footer.textContent = 'Looking for flights…';
    }

    const age = watchAge(el, config.timezone, () => shown?.fetchedAt ?? null, () => { if (shown) render(ui, shown, config); });
    stopAge = age.stop;

    const poll = async (): Promise<Outcome> => {
      try {
        const data = await getJson<AirportBoardResponse>(`/api/airport?code=${encodeURIComponent(airport.icao)}`);
        shown = data;
        render(ui, data, config);
        age.check();
        remember('airport', placeOf(airport), data);
        return data.arrivals.length || data.departures.length ? 'found' : 'empty';
      } catch {
        if (!shown) ui.footer.textContent = 'Looking for flights…';
        return 'failed';
      }
    };
    age.check();
    refresher = new Refresher(poll);
    refresher.now();
  },
  unmount() {
    refresher?.stop();
    refresher = undefined;
    stopAge?.();
    stopAge = undefined;
  },
};
