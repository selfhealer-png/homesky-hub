import {
  CLOCK_STYLES, DEFAULT_NIGHT, MOTION_LEVELS, SCREEN_IDS, cleanFollow, isFollow,
  type ClockStyle, type GoogleItem, type MotionLevel, type RadarMap, type SavedAirport, type ScreenId,
} from '../shared/settings';
import type { DeviceAlbum } from '../shared/device';
import type { BoardTheme } from '../shared/types';
import type { Warmth } from '../shared/wear';
import { CLOCK_LABELS, clockPreview } from './clockPreview';
import { airportsAround, type NearbyAirport } from './nearbyAirports';
import { devicePosition } from './native';
import { h } from './screen';

// First-run setup, on the display itself. The person first picks the screens they want, from
// real previews (public/previews/), then gets one page for each picked screen that needs a
// choice. Every page can be skipped: the screen then keeps its defaults, or, if it can't show
// anything without a choice (tides, airport, flight, photos), stays out of the rotation until
// it's set up in Settings. Location is asked once, just before the first screen that needs it.
// Nothing is saved until "Start the display", so Back never leaves half a setup behind.

interface ScreenInfo { title: string; line: string; needsLocation: boolean; picked: boolean }

const SCREENS: Record<ScreenId, ScreenInfo> = {
  home: { title: 'Home', line: 'Calendar and tasks', needsLocation: false, picked: true },
  weather: { title: 'Weather', line: 'Now, today and the week', needsLocation: true, picked: true },
  rain: { title: 'Rain radar', line: 'Rain on its way', needsLocation: true, picked: false },
  tides: { title: 'Tides', line: 'For a place by the sea', needsLocation: true, picked: false },
  board: { title: 'Overhead board', line: 'The plane above you', needsLocation: true, picked: false },
  radar: { title: 'Radar', line: 'Planes around you', needsLocation: true, picked: true },
  airport: { title: 'Airport board', line: 'Arrivals and departures', needsLocation: true, picked: false },
  flight: { title: 'Flight tracker', line: 'One flight, anywhere', needsLocation: false, picked: false },
  tonight: { title: 'Tonight', line: 'Worth looking up?', needsLocation: true, picked: false },
  iss: { title: 'Space Station', line: 'Where it is now', needsLocation: true, picked: false },
  clock: { title: 'Clock', line: 'Word, digital, analogue, flap', needsLocation: false, picked: true },
  photos: { title: 'Photos', line: 'A photo frame', needsLocation: false, picked: true },
  wiki: { title: 'Wikipedia', line: 'Article of the day', needsLocation: false, picked: false },
};

/** Screens with a page of their own; the rest are ready as soon as they're picked. */
const HAS_PAGE: ScreenId[] = ['home', 'weather', 'tides', 'board', 'radar', 'airport', 'flight', 'clock', 'photos'];

type Coords = { lat: number; lon: number };
type Location = { mode: 'device'; coords: Coords | null } | { mode: 'place'; name: string; lat: number; lon: number };

interface Choice {
  screens: Set<ScreenId>;
  location: Location | null;
  calendar: { name: string; url: string } | null;
  warmth: Warmth;
  tidePlace: { name: string; lat: number; lon: number } | null;
  boardTheme: BoardTheme;
  radarMap: RadarMap;
  airport: SavedAirport | null;
  follow: string;
  clock: ClockStyle;
  album: { id: string; title: string } | null;
  calendarMode: 'device' | 'link';
  deviceCalendars: { calendars: GoogleItem[]; reminderLists: GoogleItem[] } | null;
  motion: MotionLevel;
  quietHours: boolean;
}

type StepKey = 'welcome' | 'pick' | 'location' | ScreenId | 'finish';

const MOTION_TEXT: Record<MotionLevel, [string, string]> = {
  full: ['Full', 'Letters flip and photos drift.'],
  gentle: ['Gentle', 'Changes fade softly.'],
  still: ['Still', 'Nothing animates.'],
};
const BOARD_TEXT: Record<BoardTheme, [string, string]> = {
  splitflap: ['Split-flap', 'Cream letters on black tiles'],
  led: ['LED', 'Amber dots, like a station sign'],
  minimal: ['Minimal', 'Clean type, no tiles'],
};
const MAP_TEXT: Array<[RadarMap, string, string]> = [
  ['map', 'Street map', 'Towns and roads'],
  ['satellite', 'Satellite', 'From above'],
  ['plain', 'Plain', 'Rings only, nothing behind'],
];
const WARMTH_TEXT: Record<Warmth, [string, string]> = {
  cold: ['I feel the cold', 'Suggests warmer clothes'],
  normal: ['About average', ''],
  warm: ['I run warm', 'Suggests lighter clothes'],
};
const BOARD_THEME_KEY = 'hub.boardTheme';

async function admin(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-admin': '1' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Saving didn’t work. Try again.');
  return data;
}

function option(name: string, checked: boolean, title: string, sub: string, onPick: () => void, type: 'radio' | 'checkbox' = 'radio') {
  const input = h('input');
  Object.assign(input, { type, name, checked });
  input.addEventListener('change', () => onPick());
  const label = h('label', 'ob-option');
  const text = h('span', 'ob-option-text');
  text.append(h('b', undefined, title));
  if (sub) text.append(h('small', undefined, sub));
  label.append(input, text);
  return label;
}

function options(...items: HTMLElement[]) {
  const box = h('div', 'ob-options');
  box.append(...items);
  return box;
}

function preview(id: ScreenId): HTMLElement {
  if (id === 'photos') {
    // No stock photo ships with the app: a frame stands in for the person's own pictures.
    const p = h('div', 'wz-shot wz-photo-stand-in');
    p.append(h('span', undefined, 'Your photos'));
    return p;
  }
  const img = h('img', 'wz-shot');
  Object.assign(img, { src: `/previews/${id}.jpg`, alt: '', decoding: 'async', loading: 'lazy' });
  return img;
}

/** A place search over Open-Meteo's geocoding, shared by the location and tides pages. */
function placeSearch(onPick: (p: { name: string; lat: number; lon: number }) => void, placeholder = 'Town, city or postcode') {
  const results = h('div', 'ob-results');
  const query = h('input');
  Object.assign(query, { type: 'text', placeholder, autocomplete: 'off' });
  query.setAttribute('aria-label', 'Search for a place');
  const search = h('button', 'wel-secondary', 'Search');
  search.type = 'submit';
  const form = h('form', 'ob-search');
  form.append(query, search);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!query.value.trim()) return;
    search.disabled = true;
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(query.value.trim())}`).then(r => r.json()).catch(() => null);
    search.disabled = false;
    const found: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string }> = res?.results ?? [];
    results.replaceChildren(...(found.length ? found.map(r => {
      const b = h('button', 'ob-result');
      b.type = 'button';
      b.append(h('b', undefined, r.name), h('small', undefined, [r.admin1, r.country].filter(Boolean).join(', ')));
      b.addEventListener('click', () => { results.replaceChildren(); onPick({ name: r.name, lat: r.latitude, lon: r.longitude }); });
      return b;
    }) : [h('p', 'ob-hint', 'No matches. Try a nearby town.')]));
  });
  const box = h('div', 'ob-place');
  box.append(form, results);
  return { box, focus: () => query.focus() };
}

export function runOnboarding(root: HTMLElement, onDone: () => void) {
  const choice: Choice = {
    screens: new Set(SCREEN_IDS.filter(id => SCREENS[id].picked)),
    location: null,
    calendar: null,
    warmth: 'normal',
    tidePlace: null,
    boardTheme: 'splitflap',
    radarMap: 'map',
    airport: null,
    follow: '',
    clock: 'word',
    album: null,
    calendarMode: 'device',
    deviceCalendars: null,
    motion: 'gentle',
    quietHours: true,
  };
  let at = 0;
  let pickScroll = 0;
  let albumCache: DeviceAlbum[] | null = null;
  // In the iOS app the iPad's own calendars and photos are offered; known before the first tap.
  let hasDevice = false;
  void fetch('/api/admin/state').then(r => r.json()).then((st: { status?: { device?: boolean } }) => { hasDevice = !!st.status?.device; }).catch(() => {});

  const card = h('section', 'wz');
  root.replaceChildren(card);
  root.hidden = false;
  root.className = 'welcome wz-root';

  const steps = (): StepKey[] => {
    const list: StepKey[] = ['welcome', 'pick'];
    let located = false;
    for (const id of SCREEN_IDS) {
      if (!choice.screens.has(id)) continue;
      if (SCREENS[id].needsLocation && !located) { list.push('location'); located = true; }
      if (HAS_PAGE.includes(id)) list.push(id);
    }
    list.push('finish');
    return list;
  };

  const coords = (): Coords | null => {
    const l = choice.location;
    if (!l) return null;
    return l.mode === 'place' ? { lat: l.lat, lon: l.lon } : l.coords;
  };

  const button = (text: string, kind: 'primary' | 'secondary', onClick: () => void | Promise<void>) => {
    const b = h('button', kind === 'primary' ? 'wel-primary' : 'wel-secondary', text);
    b.type = 'button';
    b.addEventListener('click', () => void onClick());
    return b;
  };

  const go = (delta: number) => { at = Math.max(0, Math.min(steps().length - 1, at + delta)); render(); };

  /** Lays out one page: progress, title, lede, body, and Back / Skip / Next. */
  function page(o: { title: string; lede?: string; body: Node[]; side?: ScreenId; next?: () => boolean | Promise<boolean>; skip?: () => void; nextLabel?: string; footer?: Node }) {
    const list = steps();
    const progress = h('p', 'ob-step', `Step ${at + 1} of ${list.length}`);
    const main = h('div', 'wz-main');
    main.append(...o.body);
    const content = h('div', o.side ? 'wz-content wz-with-side' : 'wz-content');
    if (o.side) {
      const side = h('figure', 'wz-side');
      side.append(preview(o.side), h('figcaption', undefined, `${SCREENS[o.side].title} screen`));
      content.append(side);
    }
    content.append(main);

    const bar = h('div', 'wz-bar');
    const left = h('div', 'wz-bar-left');
    if (o.footer) left.append(o.footer);
    const actions = h('div', 'ob-actions');
    if (at > 0) actions.append(button('Back', 'secondary', () => go(-1)));
    if (o.skip) actions.append(button('Skip', 'secondary', () => { o.skip!(); go(1); }));
    actions.append(button(o.nextLabel ?? 'Next', 'primary', async () => {
      if (o.next && !(await o.next())) return;
      go(1);
    }));
    bar.append(left, actions);

    const head = h('header', 'wz-head');
    head.append(progress, h('h1', undefined, o.title));
    if (o.lede) head.append(h('p', 'wel-lede', o.lede));
    card.replaceChildren(head, content, bar);
  }

  // ── Welcome ───────────────────────────────────────────────────────────────
  function welcome() {
    page({
      title: 'Welcome to Home&Sky Hub',
      lede: 'This screen becomes a calm display for home and the sky above it.',
      body: [h('p', 'wz-intro', 'First pick the screens you’d like to see. Then set each one up, or skip it and come back later in Settings. It takes a couple of minutes.')],
      nextLabel: 'Get started',
    });
  }

  // ── Pick screens ──────────────────────────────────────────────────────────
  function pick() {
    const grid = h('div', 'wz-grid');
    const count = h('span', 'wz-count');
    const showCount = () => { count.textContent = `${choice.screens.size} screen${choice.screens.size === 1 ? '' : 's'} picked`; };
    for (const id of SCREEN_IDS) {
      const s = SCREENS[id];
      const tile = h('button', 'wz-tile');
      tile.type = 'button';
      const sync = () => {
        const on = choice.screens.has(id);
        tile.classList.toggle('on', on);
        tile.setAttribute('aria-pressed', String(on));
      };
      const text = h('span', 'wz-tile-text');
      text.append(h('b', undefined, s.title), h('small', undefined, s.line));
      tile.append(preview(id), h('span', 'wz-tick', '✓'), text);
      tile.addEventListener('click', () => {
        if (choice.screens.has(id)) choice.screens.delete(id); else choice.screens.add(id);
        sync();
        showCount();
      });
      sync();
      grid.append(tile);
    }
    showCount();
    // Three across, so each preview is big enough to read. The rows run past the bottom on
    // purpose: the cut-off row says there's more (iPad hides scrollbars), and the pill says it.
    const scroll = h('div', 'wz-scroll');
    scroll.append(grid);
    const more = h('span', 'wz-more', 'Scroll for more screens ↓');
    more.setAttribute('aria-hidden', 'true');
    const scroller = h('div', 'wz-scroller');
    scroller.append(scroll, more);
    const update = () => {
      pickScroll = scroll.scrollTop;
      more.classList.toggle('gone', scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 8);
    };
    scroll.addEventListener('scroll', update, { passive: true });
    const error = h('p', 'wel-error');
    error.setAttribute('role', 'alert');
    page({
      title: 'Which screens would you like?',
      lede: 'They take turns on the display. Tap to add or remove. You can change this any time.',
      body: [scroller, error],
      footer: count,
      next: () => {
        if (choice.screens.size) return true;
        error.textContent = 'Pick at least one screen.';
        return false;
      },
    });
    requestAnimationFrame(() => { scroll.scrollTop = pickScroll; update(); });
  }

  // ── Location (once, before the first screen that needs it) ───────────────
  function location() {
    const l = choice.location;
    const chosen = h('p', 'ob-chosen', l?.mode === 'place' ? `✓ ${l.name}` : '');
    const search = placeSearch(p => { choice.location = { mode: 'place', ...p }; chosen.textContent = `✓ ${p.name}`; });
    search.box.append(chosen);
    search.box.hidden = l?.mode !== 'place';
    let wantPlace = l?.mode === 'place';
    const needing = SCREEN_IDS.filter(id => choice.screens.has(id) && SCREENS[id].needsLocation).map(id => SCREENS[id].title);
    page({
      title: 'Where is this screen?',
      lede: `${needing.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${needing.length === 1 ? 'is' : 'are'} centred here, rounded to about 1 km.`,
      body: [options(
        option('where', !wantPlace, 'Use this device’s location', 'Best for a screen that stays at home. It asks permission once.', () => { wantPlace = false; search.box.hidden = true; }),
        option('where', wantPlace, 'Choose a place', 'Search a town or postcode instead.', () => { wantPlace = true; search.box.hidden = false; search.focus(); }),
      ), search.box],
      skip: () => { choice.location = null; },
      next: async () => {
        if (!wantPlace) {
          // Asked now, while someone is here to answer, rather than later on an unattended screen.
          choice.location = { mode: 'device', coords: await devicePosition() };
          return true;
        }
        if (choice.location?.mode === 'place') return true;
        chosen.textContent = 'Search for your place and pick it from the list first.';
        return false;
      },
    });
  }

  // ── Home: a calendar ──────────────────────────────────────────────────────
  function home() {
    const name = h('input');
    Object.assign(name, { type: 'text', value: choice.calendar?.name ?? 'Family', maxLength: 60, id: 'ob-cal-name' });
    const link = h('input');
    Object.assign(link, { type: 'url', value: choice.calendar?.url ?? '', placeholder: 'https://… or webcal://…', inputMode: 'url', id: 'ob-cal-link', autocomplete: 'off' });
    const result = h('p', 'ob-result-line');
    const test = h('button', 'wel-secondary', 'Test link');
    test.type = 'button';
    test.addEventListener('click', async () => {
      if (!link.value.trim()) return;
      test.disabled = true;
      result.className = 'ob-result-line';
      result.textContent = 'Checking…';
      try {
        const r = (await admin('/api/admin/connections/test', { kind: 'ics', url: link.value })) as { ok?: boolean; events?: number; upcoming?: string[]; error?: string };
        if (!r.ok) throw new Error(r.error ?? 'Couldn’t read that calendar.');
        result.className = 'ob-result-line good';
        result.textContent = r.events ? `✓ Found ${r.events} event${r.events === 1 ? '' : 's'} in the next three weeks${r.upcoming?.length ? `, like “${r.upcoming[0]}”` : ''}.` : '✓ The calendar works, but has nothing in the next three weeks.';
      } catch (err) {
        result.className = 'ob-result-line bad';
        result.textContent = (err as Error).message;
      } finally {
        test.disabled = false;
      }
    });
    const help = h('details', 'ob-help');
    help.append(h('summary', undefined, 'Where do I find my calendar link?'));
    for (const [title, text] of [
      ['Google Calendar', 'On a computer: calendar.google.com → gear → Settings → pick the calendar → “Secret address in iCal format”.'],
      ['iCloud', 'Calendar app → Calendars → ⓘ next to the calendar → turn on Public Calendar → Share Link.'],
      ['Outlook', 'Outlook on the web → Settings → Calendar → Shared calendars → Publish → copy the ICS link.'],
    ] as const) help.append(h('p', undefined, `${title}: ${text}`));
    const nameLabel = h('label', 'wel-label', 'Name on the display');
    nameLabel.htmlFor = 'ob-cal-name';
    const linkLabel = h('label', 'wel-label', 'Calendar link');
    linkLabel.htmlFor = 'ob-cal-link';
    const linkRow = h('div', 'ob-search');
    linkRow.append(link, test);
    const fields = h('div', 'ob-fields');
    fields.append(nameLabel, name, linkLabel, linkRow, result, help);
    const keep = () => { choice.calendar = link.value.trim() ? { name: name.value.trim() || 'Calendar', url: link.value.trim() } : null; };
    if (!hasDevice) {
      page({
        title: 'Which calendar should Home show?',
        lede: 'Paste a private calendar link. Google Calendar and Tasks, and more calendars, can be added later in Settings.',
        side: 'home',
        body: [fields],
        skip: () => { choice.calendar = null; },
        next: () => { keep(); return true; },
      });
      return;
    }
    // In the app: the calendars and reminders already on this iPad, or a link.
    fields.hidden = choice.calendarMode !== 'link';
    const picks = h('div', 'wz-picks');
    const note = h('p', 'ob-hint');
    const showPicks = () => {
      const d = choice.deviceCalendars;
      if (!d) return;
      const group = (title: string, items: GoogleItem[]) => items.length
        ? [h('h2', 'ob-sub', title), options(...items.map(it => option(`dev-${it.id}`, it.enabled, it.name, '', () => { it.enabled = !it.enabled; }, 'checkbox')))]
        : [];
      picks.replaceChildren(...group('Calendars', d.calendars), ...group('Reminders', d.reminderLists));
      if (!d.calendars.length && !d.reminderLists.length) picks.append(h('p', 'ob-hint', 'Nothing to show yet. Calendars added in the iPad’s Settings appear here.'));
    };
    const allow = h('button', 'wel-secondary', 'Allow and choose');
    allow.type = 'button';
    allow.addEventListener('click', async () => {
      allow.disabled = true;
      try {
        const r = await admin('/api/admin/device/choices', {}) as unknown as { calendars: GoogleItem[]; reminderLists: GoogleItem[]; problems: string[] };
        // Everything on to start with: easier to untick a few than to find them.
        choice.deviceCalendars = { calendars: r.calendars.map(c => ({ ...c, enabled: true })), reminderLists: r.reminderLists.map(l => ({ ...l, enabled: true })) };
        note.textContent = r.problems.join(' ');
        allow.remove();
        showPicks();
      } catch (err) {
        note.textContent = (err as Error).message;
        allow.disabled = false;
      }
    });
    const deviceBox = h('div', 'wz-device');
    deviceBox.hidden = choice.calendarMode !== 'device';
    deviceBox.append(...(choice.deviceCalendars ? [] : [allow]), picks, note);
    showPicks();
    page({
      title: 'Which calendars should Home show?',
      lede: 'Events, overdue items and the next few days. The app only reads them.',
      side: 'home',
      body: [options(
        option('calsrc', choice.calendarMode === 'device', 'Calendars and reminders on this iPad', 'iCloud, and any Google or Exchange accounts added in the iPad’s Settings.', () => { choice.calendarMode = 'device'; deviceBox.hidden = false; fields.hidden = true; }),
        option('calsrc', choice.calendarMode === 'link', 'Paste a calendar link', 'Any iCal or webcal address.', () => { choice.calendarMode = 'link'; deviceBox.hidden = true; fields.hidden = false; }),
      ), deviceBox, fields],
      skip: () => { choice.calendar = null; choice.deviceCalendars = null; },
      next: () => { if (choice.calendarMode === 'link') { keep(); choice.deviceCalendars = null; } else choice.calendar = null; return true; },
    });
  }

  // ── Weather ───────────────────────────────────────────────────────────────
  function weather() {
    page({
      title: 'Weather',
      lede: 'It suggests what to wear. Do you feel the cold?',
      side: 'weather',
      body: [options(...(['cold', 'normal', 'warm'] as Warmth[]).map(w =>
        option('warmth', choice.warmth === w, WARMTH_TEXT[w][0], WARMTH_TEXT[w][1], () => { choice.warmth = w; })))],
      skip: () => { choice.warmth = 'normal'; },
    });
  }

  // ── Tides ─────────────────────────────────────────────────────────────────
  function tides() {
    const chosen = h('p', 'ob-chosen', choice.tidePlace ? `✓ ${choice.tidePlace.name}` : '');
    const search = placeSearch(p => { choice.tidePlace = p; chosen.textContent = `✓ ${p.name}`; }, 'A town on the coast');
    search.box.append(chosen);
    page({
      title: 'Where should tides be read?',
      lede: 'Choose somewhere right on the coast. A guide from a global model, not for navigation.',
      side: 'tides',
      body: [search.box],
      skip: () => { choice.tidePlace = null; },
    });
  }

  // ── Overhead board ────────────────────────────────────────────────────────
  function board() {
    page({
      title: 'Pick a board style',
      lede: 'The plane passing closest overhead. Tapping the board later switches style.',
      side: 'board',
      body: [options(...(['splitflap', 'led', 'minimal'] as BoardTheme[]).map(t =>
        option('board', choice.boardTheme === t, BOARD_TEXT[t][0], BOARD_TEXT[t][1], () => { choice.boardTheme = t; })))],
      skip: () => { choice.boardTheme = 'splitflap'; },
    });
  }

  // ── Radar ─────────────────────────────────────────────────────────────────
  function radar() {
    page({
      title: 'What should the radar show underneath?',
      lede: 'Live aircraft around you. The range and alerts can be changed in Settings.',
      side: 'radar',
      body: [options(...MAP_TEXT.map(([m, title, sub]) => option('map', choice.radarMap === m, title, sub, () => { choice.radarMap = m; })))],
      skip: () => { choice.radarMap = 'map'; },
    });
  }

  // ── Airport board ─────────────────────────────────────────────────────────
  function airport() {
    const box = options();
    const here = coords();
    if (!here) box.append(h('p', 'ob-hint', 'Without a location there’s nothing to suggest. Choose an airport in Settings › Sky.'));
    else {
      box.append(h('p', 'ob-hint', 'Looking for airports nearby…'));
      airportsAround(here.lat, here.lon, 60).then(found => {
        const big = found.filter(a => a.size !== 's').slice(0, 4);
        if (!big.length) { box.replaceChildren(h('p', 'ob-hint', 'No airports with scheduled flights nearby. Choose one in Settings › Sky.')); return; }
        const km = (a: NearbyAirport) => Math.round(Math.hypot((a.lon - here.lon) * 111.32 * Math.cos((here.lat * Math.PI) / 180), (a.lat - here.lat) * 110.57));
        choice.airport ??= saved(big[0]);
        box.replaceChildren(...big.map(a => option('airport', choice.airport?.icao === a.icao, a.name, `${a.iata || a.icao} · ${km(a)} km`, () => { choice.airport = saved(a); })));
      }).catch(() => box.replaceChildren(h('p', 'ob-hint', 'Couldn’t load the airport list. Choose one in Settings › Sky.')));
    }
    page({
      title: 'Which airport?',
      lede: 'Its arrivals and departures, on a split-flap board.',
      side: 'airport',
      body: [box],
      skip: () => { choice.airport = null; },
    });
  }
  const saved = (a: NearbyAirport): SavedAirport => ({ icao: a.icao, iata: a.iata, name: a.name, city: a.name, lat: a.lat, lon: a.lon });

  // ── Flight tracker ────────────────────────────────────────────────────────
  function flight() {
    const input = h('input');
    Object.assign(input, { type: 'text', value: choice.follow, placeholder: 'BA117, BAW117 or G-XLEA', autocomplete: 'off', autocapitalize: 'characters', id: 'ob-follow' });
    const label = h('label', 'wel-label', 'Flight number, callsign or registration');
    label.htmlFor = 'ob-follow';
    const error = h('p', 'wel-error');
    error.setAttribute('role', 'alert');
    input.addEventListener('input', () => { error.textContent = ''; });
    const fields = h('div', 'ob-fields');
    fields.append(label, input, error);
    page({
      title: 'Which flight should it follow?',
      lede: 'Followed anywhere in the world on a route map. It also goes first on the overhead board when it passes.',
      side: 'flight',
      body: [fields],
      skip: () => { choice.follow = ''; },
      next: () => {
        const v = cleanFollow(input.value);
        if (v && !isFollow(v)) { error.textContent = 'That doesn’t look like a flight number or registration.'; return false; }
        choice.follow = v;
        return true;
      },
    });
  }

  // ── Clock ─────────────────────────────────────────────────────────────────
  function clock() {
    const clocks = h('div', 'ob-clocks');
    for (const style of CLOCK_STYLES) {
      const input = h('input');
      Object.assign(input, { type: 'radio', name: 'clock', value: style, checked: choice.clock === style });
      input.addEventListener('change', () => { choice.clock = style; });
      const label = h('label', 'ob-clock');
      label.append(input, clockPreview(style), h('b', undefined, CLOCK_LABELS[style][0]));
      clocks.append(label);
    }
    page({
      title: 'Pick a clock',
      lede: CLOCK_LABELS[choice.clock][1],
      side: 'clock',
      body: [clocks],
      skip: () => { choice.clock = 'word'; },
    });
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  function photos() {
    const body: Node[] = [];
    if (!hasDevice) {
      body.push(h('p', 'wz-intro', 'Photos are connected in Settings › Photos once setup is done. Until then the photo frame stays out of the rotation.'));
    } else {
      // Apple Photos: ask for access, then pick one album (a Shared Album works too).
      const list = options();
      const note = h('p', 'ob-hint');
      const showAlbums = (albums: DeviceAlbum[]) => {
        if (!albums.length) { list.replaceChildren(h('p', 'ob-hint', 'No albums in Photos yet. Make one, or choose later in Settings.')); return; }
        choice.album ??= { id: albums[0].id, title: albums[0].title };
        list.replaceChildren(...albums.map(a => option('album', choice.album?.id === a.id, a.title,
          `${a.count} photo${a.count === 1 ? '' : 's'}${a.shared ? ' · Shared Album' : ''}`, () => { choice.album = { id: a.id, title: a.title }; })));
      };
      const allow = h('button', 'wel-secondary', 'Choose an album in Apple Photos');
      allow.type = 'button';
      allow.addEventListener('click', async () => {
        allow.disabled = true;
        try {
          const r = await admin('/api/admin/device/albums', {}) as unknown as { limited: boolean; albums: DeviceAlbum[] };
          note.textContent = r.limited ? 'Only the photos you selected are visible. To show a whole album as it grows, allow all photos in the iPad’s Settings.' : '';
          allow.remove();
          albumCache = r.albums;
          showAlbums(r.albums);
        } catch (err) {
          note.textContent = (err as Error).message;
          allow.disabled = false;
        }
      });
      if (albumCache) showAlbums(albumCache); else list.append(allow);
      body.push(list, note);
    }
    page({
      title: 'Where should photos come from?',
      lede: hasDevice ? 'An album from Photos is shown live, so new photos appear on their own. Google Photos can be added later in Settings.' : 'The frame shows them as they are, so new photos appear on their own.',
      side: 'photos',
      body,
      skip: () => { choice.album = null; },
    });
  }

  // ── Finishing touches, and saving ─────────────────────────────────────────
  function finish() {
    const motion = options(...MOTION_LEVELS.map(level => option('motion', choice.motion === level, MOTION_TEXT[level][0], MOTION_TEXT[level][1], () => { choice.motion = level; })));
    const quiet = options(option('quiet', choice.quietHours, `Quiet hours, ${DEFAULT_NIGHT.from} to ${DEFAULT_NIGHT.to}`, 'Dims and shows only the clock, Home and Tonight.', () => { choice.quietHours = !choice.quietHours; }, 'checkbox'));
    const error = h('p', 'wel-error');
    error.setAttribute('role', 'alert');
    page({
      title: 'Finishing touches',
      lede: 'How the display behaves through the day. Keep it on power: the screen stays on by itself.',
      body: [h('h2', 'ob-sub', 'Motion'), motion, h('h2', 'ob-sub', 'At night'), quiet, error],
      nextLabel: 'Start the display',
      next: async () => {
        try { await save(); } catch (err) { error.textContent = (err as Error).message; return false; }
        root.hidden = true;
        root.className = '';
        onDone();
        return false; // the wizard is gone; nothing to step to
      },
    });
  }

  async function save() {
    const l = choice.location;
    await admin('/api/admin/sky', {
      ...(l?.mode === 'place' ? { places: [{ name: l.name, lat: l.lat, lon: l.lon }], active: '' } : { places: [], active: 'device' }),
      radiusNm: 25,
      map: choice.radarMap,
      airports: choice.screens.has('airport') && choice.airport ? [choice.airport] : [],
      follow: choice.screens.has('flight') ? choice.follow : '',
      tidePlace: choice.screens.has('tides') && choice.tidePlace ? choice.tidePlace : null,
    });
    if (choice.screens.has('home') && choice.calendar) await admin('/api/admin/connections/add', { kind: 'ics', name: choice.calendar.name, url: choice.calendar.url, color: '#2563FF' });
    await admin('/api/admin/display', {
      clock: choice.clock,
      motion: choice.motion,
      warmth: choice.warmth,
      photoStyle: 'fill',
      night: { ...DEFAULT_NIGHT, mode: choice.quietHours ? 'quiet' : 'evening' },
      screensOff: SCREEN_IDS.filter(id => !choice.screens.has(id)),
    });
    try { localStorage.setItem(BOARD_THEME_KEY, choice.boardTheme); } catch { /* not remembered: the board starts on its default */ }
    if (choice.screens.has('home') && choice.deviceCalendars) await admin('/api/admin/device/selection', choice.deviceCalendars);
    if (choice.screens.has('photos') && choice.album) await admin('/api/admin/photos/source', { kind: 'apple', albumId: choice.album.id, title: choice.album.title });
  }

  const PAGES: Record<StepKey, () => void> = {
    welcome, pick, location, finish, home, weather, tides, board, radar, airport, flight, clock, photos,
    rain: finish, tonight: finish, iss: finish, wiki: finish, // never steps of their own
  };
  const render = () => PAGES[steps()[at]]();
  render();
}
