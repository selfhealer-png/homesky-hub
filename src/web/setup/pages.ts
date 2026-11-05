import { CLOCK_LABELS, clockPreview } from '../clockPreview';
import {
  CLOCK_STYLES, DEFAULT_DISPLAY, DEFAULT_NIGHT, DEFAULT_RADAR_MAP, DEFAULT_SCREEN_SEC, MOTION_LEVELS, NIGHT_MODES, SCREEN_SEC_STEPS, WARMTH_LEVELS,
  screenSeconds, type MotionLevel, type NightMode, type ScreenId, type Settings,
} from '../../shared/settings';
import type { Warmth } from '../../shared/wear';
import { calendarChoices, calendarCount } from './accounts';
import { PHOTO_LABELS, photoCount, photoSections } from './photos';
import { airportCards, airportCodes, alertsCard, followCard, locationRow, MAP_LABELS, mapCard, rangeCard, tideCards, tidePlaceName } from './sky';
import { displaySettings, isScreenOn, km, placeName, SAVED, saveDisplay, setScreenOn, skySettings, state } from './store';
import { screenOrder } from '../../shared/rotation';
import { IN_APP } from '../api';
import { api, busy, card, choiceList, copyRow, h, iosSwitch, pageHead, quietly, row, segmented, svg, tile, toast } from './ui';

// Every screen the hub can show, with its row on the Settings list and its own page, and the
// hub-wide pages (Night, Motion, This hub).

interface Summary { text: string; needs?: boolean }

/** How the Settings list groups the screens, in this order. */
export const CATEGORIES = [
  ['everyday', 'Everyday'],
  ['weather', 'Weather and sky'],
  ['flights', 'Flights'],
  ['pictures', 'Pictures and reading'],
] as const;
type Category = typeof CATEGORIES[number][0];

export interface ScreenDef {
  id: ScreenId;
  name: string;
  category: Category;
  /** What it shows, under the title on its page. */
  lede: string;
  icon: string;
  color: string;
  /** Stays in the rotation during quiet hours (matches the display's screen modules). */
  quiet?: boolean;
  summary(): Summary;
  body(): Node[];
}

const plural = (n: number, word: string) => n ? `${n} ${word}${n === 1 ? '' : 's'}` : '';

const WARMTH_LABELS: Record<Warmth, string> = { cold: 'I run cold', normal: 'Typical', warm: 'I run warm' };

export const SCREENS: ScreenDef[] = [
  {
    id: 'home', name: 'Home', category: 'everyday', color: '#FF3B30', quiet: true,
    lede: 'Today’s calendar and tasks, readable across the room.',
    icon: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    summary: () => {
      const { calendars, lists } = calendarCount();
      const parts = [plural(calendars, 'calendar'), plural(lists, 'task list')].filter(Boolean);
      return parts.length ? { text: parts.join(' · ') } : { text: 'Add a calendar to fill it', needs: true };
    },
    body: () => calendarChoices(),
  },
  {
    id: 'weather', name: 'Weather', category: 'weather', color: '#32ADE6',
    lede: 'Now, the next hours and days, and what to wear.',
    icon: '<path d="M8.5 3.5v1.6M3.5 8.5h1.6M5 5l1.1 1.1M12.4 5.1 11.3 6.2"/><path d="M5.6 11.3a3.4 3.4 0 0 1 6.2-2.3"/><path d="M9.5 20h8a3.6 3.6 0 0 0 .5-7.15 5.2 5.2 0 0 0-9.9-1A3.7 3.7 0 0 0 9.5 20Z"/>',
    summary: () => ({ text: `${placeName()} · ${WARMTH_LABELS[displaySettings().warmth ?? 'normal']}` }),
    body: () => {
      const d = displaySettings();
      return [
        locationRow(),
        card('What to wear',
          segmented('warmth', 'Clothing advice', WARMTH_LEVELS.map(w => [w, WARMTH_LABELS[w]] as [Warmth, string]), d.warmth ?? 'normal',
            warmth => quietly(saveDisplay({ ...d, warmth }))),
          h('p', { class: 'hint' }, 'Dresses you for about 3° colder or warmer than it feels.')),
      ];
    },
  },
  {
    id: 'rain', name: 'Rain map', category: 'weather', color: '#007AFF',
    lede: 'The last hour of rain radar around your place, with the chance of rain hour by hour.',
    icon: '<path d="M7 15.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7.1 4.2 4.2 0 0 0 7 15.5Z"/><path d="M8.5 18.5 7.5 21M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>',
    summary: () => ({ text: placeName() }),
    body: () => [locationRow(), card(null, h('p', { class: 'hint' }, 'The map is about 300 km across, so it shows the rain that’s on its way. Radar: RainViewer; map: OpenStreetMap.'))],
  },
  {
    id: 'tides', name: 'Tides', category: 'weather', color: '#30B0C7',
    lede: 'Whether the tide is coming in or going out, when it turns, and the day’s high and low water.',
    icon: '<path d="M3 9c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0"/><path d="M3 14c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0"/><path d="M3 19c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0"/>',
    summary: () => {
      const place = tidePlaceName();
      return place ? { text: place } : { text: 'Choose a place by the sea', needs: true };
    },
    body: () => tideCards(),
  },
  {
    id: 'board', name: 'Overhead', category: 'flights', color: '#AF52DE',
    lede: 'A split-flap board of the planes passing over right now.',
    icon: '<path d="M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5Z"/>',
    summary: () => ({ text: `${placeName()} · ${km(skySettings().radiusNm)}` }),
    body: () => [locationRow(), rangeCard('Flight radar'), alertsCard()],
  },
  {
    id: 'radar', name: 'Flight radar', category: 'flights', color: '#34C759',
    lede: 'Live aircraft on a radar sweep around your place.',
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 5.5-5.5"/>',
    summary: () => ({ text: `${placeName()} · ${km(skySettings().radiusNm)} · ${MAP_LABELS[skySettings().map ?? DEFAULT_RADAR_MAP]}` }),
    body: () => [locationRow(), rangeCard('Overhead'), mapCard()],
  },
  {
    id: 'airport', name: 'Airport boards', category: 'flights', color: '#FF9500',
    lede: 'Arrivals and departures boards for airports you choose.',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h4M14 10h3M14 14h3"/>',
    summary: () => {
      const codes = airportCodes();
      return codes.length ? { text: codes.join(' · ') } : { text: 'Add an airport to show it', needs: true };
    },
    body: () => airportCards(),
  },
  {
    id: 'flight', name: 'Flight tracker', category: 'flights', color: '#FF2D55',
    lede: 'One flight you choose, followed anywhere in the world: its route, how far along it is, how high and fast.',
    icon: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M6.5 16.5C9 11 13 13 17.5 7.5" stroke-dasharray="2 2.5"/>',
    summary: () => {
      const follow = skySettings().follow;
      return follow ? { text: `Following ${follow}` } : { text: 'Choose a flight to follow', needs: true };
    },
    body: () => [followCard()],
  },
  {
    id: 'tonight', name: 'Tonight', category: 'weather', color: '#5856D6', quiet: true,
    lede: 'The night sky: the moon, planets and what’s worth looking up for.',
    icon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
    summary: () => ({ text: placeName() }),
    body: () => [locationRow()],
  },
  {
    id: 'iss', name: 'Space Station', category: 'weather', color: '#00C7BE',
    lede: 'Where the International Space Station is right now, its path round the world, and who’s on board.',
    icon: '<path d="M2 9h6v6H2zM16 9h6v6h-6zM8 12h8"/><rect x="10" y="8.5" width="4" height="7" rx="1"/>',
    summary: () => ({ text: 'Live position and crew' }),
    body: () => [locationRow(), card(null, h('p', { class: 'hint' }, 'The position is worked out on the display from the station’s orbit, every second; your location gives the distance to it and the next time you can see it pass over. Orbit: CelesTrak; crew: the community-kept people-in-space list; map: NASA Blue Marble.'))],
  },
  {
    id: 'clock', name: 'Clock', category: 'everyday', color: '#8E8E93', quiet: true,
    lede: 'A big clock. It’s also what the display falls back to if every screen is off.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    summary: () => ({ text: CLOCK_LABELS[displaySettings().clock][0] }),
    body: () => {
      const d = displaySettings();
      const clocks = h('div', { class: 'clockpicker', role: 'radiogroup', 'aria-label': 'Clock style' });
      for (const style of CLOCK_STYLES) {
        const [title, sub] = CLOCK_LABELS[style];
        const radio = h('input', { type: 'radio', name: 'clock-style', value: style, checked: d.clock === style });
        radio.addEventListener('change', () => quietly(saveDisplay({ ...d, clock: style })));
        clocks.append(h('label', { class: 'clockopt' }, radio, clockPreview(style), h('b', {}, title), h('small', {}, sub)));
      }
      return [card('Style', clocks)];
    },
  },
  {
    id: 'photos', name: 'Photos', category: 'pictures', color: '#FF9500',
    lede: 'A photo frame of pictures you pick from Google Photos.',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
    summary: () => {
      if (!state.status.photos) return { text: 'Needs photo storage', needs: true };
      const n = photoCount();
      const style = PHOTO_LABELS[displaySettings().photoStyle ?? 'fill'];
      if (n === null) return { text: style };
      return n ? { text: `${n} photo${n === 1 ? '' : 's'} · ${style}` } : { text: 'Add photos to show it', needs: true };
    },
    body: () => photoSections(),
  },
  {
    id: 'wiki', name: 'Wikipedia', category: 'pictures', color: '#8E8E93',
    lede: 'Wikipedia’s featured article of the day.',
    icon: '<path d="M4 5h5a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4Z"/><path d="M20 5h-5a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h6Z"/>',
    summary: () => ({ text: (displaySettings().wikiPictures ?? true) ? 'With its picture' : 'Words only' }),
    body: () => {
      const d = displaySettings();
      return [card('Picture',
        segmented('wiki-pictures', 'Wikipedia article', [[true, 'With its picture'], [false, 'Words only']], d.wikiPictures ?? true,
          wikiPictures => quietly(saveDisplay({ ...d, wikiPictures }))),
        h('p', { class: 'hint' }, 'The featured article changes daily, and so does its picture, which can be any painting or photograph. Choose Words only if children watch the display on their own.'))];
    },
  },
];

/** The switch for a screen, on its row in the list and at the top of its page. */
export function screenSwitch(s: ScreenDef) {
  return iosSwitch(isScreenOn(s.id), `Show ${s.name}`, on => {
    // Turning on a screen that needs something chosen first (airports, a flight, a place by the
    // sea): go to its page to choose it.
    if (on && ['airport', 'flight', 'tides'].includes(s.id) && s.summary().needs && location.hash !== `#/screens/${s.id}`) location.hash = `#/screens/${s.id}`;
    return setScreenOn(s.id, on, s.name);
  });
}

export function screenRow(s: ScreenDef) {
  const on = isScreenOn(s.id);
  const sum = s.summary();
  return row({
    icon: tile(s.icon, s.color), title: s.name, href: `#/screens/${s.id}`, control: screenSwitch(s),
    summary: on ? sum.text : 'Off', needs: on && sum.needs,
  });
}

export function screenPage(s: ScreenDef) {
  const on = isScreenOn(s.id);
  const sum = s.summary();
  const night = displaySettings().night ?? DEFAULT_NIGHT;
  const quietNote = night.mode !== 'quiet' ? null
    : s.quiet ? 'Stays on during quiet hours.' : 'Hidden during quiet hours, unless it’s pinned on the display.';
  const head = card(null,
    row({ title: 'Show on the hub', summary: !on ? 'Off: left out of the rotation' : sum.needs ? sum.text : 'In the rotation', needs: on && sum.needs, control: screenSwitch(s) }),
    quietNote ? h('p', { class: 'hint' }, quietNote, ' ', h('a', { href: '#/night' }, 'Night settings')) : null);
  return [pageHead(s.name, s.lede), head, ...s.body()];
}

// ── screen order ────────────────────────────────────────────────────────────

const byId = (id: ScreenId) => SCREENS.find(s => s.id === id)!;
export const currentOrder = () => screenOrder(displaySettings().order).filter(id => SCREENS.some(s => s.id === id));

export function orderSummary() {
  const on = currentOrder().filter(isScreenOn).map(id => byId(id).name);
  return on.length > 3 ? `${on.slice(0, 3).join(', ')}…` : on.join(', ') || 'Every screen is off';
}

export function orderPage() {
  const d = displaySettings();
  const order = currentOrder();
  const save = (next: ScreenId[]) => saveDisplay({ ...d, order: next }, 'Order saved. The display picks this up within five minutes.');
  const move = (from: number, to: number) => {
    const next = [...order];
    next.splice(to, 0, ...next.splice(from, 1));
    return save(next);
  };
  const button = (label: string, path: string, action: () => Promise<void>) => {
    const b = h('button', { type: 'button', class: 'ghost small icon', 'aria-label': label }, svg(path, 16));
    b.addEventListener('click', () => busy(b, action));
    return b;
  };
  const rows = order.map((id, i) => {
    const s = byId(id);
    return row({
      icon: tile(s.icon, s.color), title: s.name, summary: isScreenOn(id) ? undefined : 'Off',
      control: h('span', { class: 'actions' },
        i > 0 ? button(`Move ${s.name} up`, '<path d="m6 15 6-6 6 6"/>', () => move(i, i - 1)) : h('span', { class: 'spacer' }),
        i < order.length - 1 ? button(`Move ${s.name} down`, '<path d="m6 9 6 6 6-6"/>', () => move(i, i + 1)) : h('span', { class: 'spacer' })),
    });
  });
  const reset = h('button', { type: 'button', class: 'ghost' }, 'Back to the usual order');
  reset.addEventListener('click', () => busy(reset, () => save(screenOrder())));
  return [
    pageHead('Screen order', 'The order the display goes through its screens. Screens that are off keep their place for when they’re back on.'),
    h('div', { class: 'rows' }, ...rows),
    h('div', { class: 'buttons' }, reset),
  ];
}

// ── screen timing ───────────────────────────────────────────────────────────

const pace = (sec: number) => sec < 60 ? `${sec} seconds` : sec === 60 ? 'minute' : `${sec / 60} minutes`;
/** For the slider's own label: "45 sec", "1½ min", "3 min". */
const shortPace = (sec: number) => sec < 60 ? `${sec} sec` : `${String(Math.floor(sec / 60))}${sec % 60 ? '½' : ''} min`;
/** For screen readers: "45 seconds", "1 and a half minutes". */
const spokenPace = (sec: number) => sec < 60 ? `${sec} seconds` : sec === 90 ? '1 and a half minutes' : sec === 60 ? '1 minute' : `${sec / 60} minutes`;

export function timingSummary() {
  const d = displaySettings();
  if (Object.keys(d.screenSec ?? {}).length) return 'Set for each screen';
  return d.rotateSec ? `Every ${pace(d.rotateSec)}` : 'Each screen’s own pace';
}

/** Saves a little after the last slider move, so dragging or holding an arrow key saves once. */
let timingSave: number | undefined;

export function timingPage() {
  const d = displaySettings();
  // What each screen gets now. A change bakes in every screen's time and drops the old one pace
  // for all (rotateSec), keeping only the times that differ from a screen's own pace.
  const current = Object.fromEntries(SCREENS.map(s => [s.id, screenSeconds(s.id, d)])) as Record<ScreenId, number>;
  const save = () => {
    const screenSec = Object.fromEntries(SCREENS.filter(s => current[s.id] !== DEFAULT_SCREEN_SEC[s.id]).map(s => [s.id, current[s.id]]));
    clearTimeout(timingSave);
    // Saved without redrawing the page, so a slider being dragged next isn't pulled from under the finger.
    timingSave = window.setTimeout(() => quietly(api<Settings>('/api/admin/display', { ...displaySettings(), rotateSec: null, screenSec })
      .then(saved => { state.settings = saved; toast(SAVED); })), 600);
  };
  const rows = currentOrder().map(id => {
    const s = byId(id);
    const value = h('output', { class: 'timing-value', for: `sec-${id}` }, shortPace(current[id]));
    const slider = h('input', {
      type: 'range', id: `sec-${id}`, class: 'timing-slider', min: '0', max: String(SCREEN_SEC_STEPS.length - 1), step: '1',
      value: String(nearestStep(current[id])), 'aria-label': `Time on ${s.name}`, 'aria-valuetext': spokenPace(current[id]),
    });
    const paint = () => {
      const sec = SCREEN_SEC_STEPS[Number(slider.value)];
      value.textContent = shortPace(sec);
      slider.setAttribute('aria-valuetext', spokenPace(sec));
      slider.style.setProperty('--p', `${(Number(slider.value) / (SCREEN_SEC_STEPS.length - 1)) * 100}%`);
      return sec;
    };
    paint();
    slider.addEventListener('input', () => { current[id] = paint(); });
    slider.addEventListener('change', () => { current[id] = paint(); save(); });
    return h('div', { class: `row timing${isScreenOn(id) ? '' : ' off'}` },
      tile(s.icon, s.color),
      h('div', { class: 'timing-main' },
        h('div', { class: 'timing-top' }, h('label', { for: `sec-${id}` }, s.name), isScreenOn(id) ? null : h('small', {}, 'Off'), value),
        slider));
  });
  const custom = Object.keys(d.screenSec ?? {}).length > 0 || !!d.rotateSec;
  const reset = h('button', { type: 'button', class: 'ghost' }, 'Back to each screen’s own pace');
  reset.addEventListener('click', () => busy(reset, () => saveDisplay({ ...d, rotateSec: null, screenSec: {} }, 'Back to each screen’s own pace. The display picks this up within five minutes.')));
  return [
    pageHead('Screen timing', 'How long the display stays on each screen before moving to the next.'),
    h('div', { class: 'rows' }, ...rows),
    h('p', { class: 'hint timing-hint' }, 'A tap on the left or right of the display still moves on straight away, and a screen you’ve pinned stays put.'),
    ...(custom ? [h('div', { class: 'buttons' }, reset)] : []),
  ];
}

/** The slider stop for a time saved before the stops existed (or between two of them). */
const nearestStep = (sec: number) => SCREEN_SEC_STEPS.reduce((best, s, i) => Math.abs(s - sec) < Math.abs(SCREEN_SEC_STEPS[best] - sec) ? i : best, 0);

// ── the time on every screen ────────────────────────────────────────────────

/** A switch for the time in the bottom corner. Off unless chosen. */
export function stripClockSwitch() {
  const d = displaySettings();
  return iosSwitch(d.stripClock ?? false, 'Show the time on every screen', on =>
    saveDisplay({ ...d, stripClock: on }, on ? 'The time shows in the corner of every screen.' : 'The time is off. Screens with their own clock still show it.'));
}

// ── hub pages ───────────────────────────────────────────────────────────────

export const NIGHT_LABELS: Record<NightMode, [string, string]> = {
  quiet: ['Dark evenings and quiet hours', 'From sunset, nothing is brighter than the dark screens. In quiet hours it also dims and shows only the clock, Home and Tonight.'],
  evening: ['Dark evenings only', 'From sunset the cream board, the street map and pictures go dark. Nothing dims.'],
  off: ['Off', 'The display looks the same day and night.'],
};

export function nightSummary() {
  const night = displaySettings().night ?? DEFAULT_NIGHT;
  return night.mode === 'quiet' ? `Quiet hours ${night.from}–${night.to}` : NIGHT_LABELS[night.mode][0];
}

export function nightPage() {
  const d = displaySettings();
  const night = d.night ?? DEFAULT_NIGHT;
  const saveNight = (next: Partial<typeof night>) => quietly(saveDisplay({ ...d, night: { ...night, ...next } }));
  const c = card(null, choiceList('night-mode', 'At night', NIGHT_MODES.map(m => [m, ...NIGHT_LABELS[m]] as [NightMode, string, string]), night.mode, mode => saveNight({ mode })));
  if (night.mode === 'quiet') {
    const time = (value: string, label: string, key: 'from' | 'to') => {
      const el = h('input', { type: 'time', value, step: '300', 'aria-label': label, required: true });
      el.addEventListener('change', () => { if (el.value) saveNight({ [key]: el.value.slice(0, 5) }); });
      return el;
    };
    c.append(h('div', { class: 'quiethours' },
      h('span', {}, 'Quiet hours'), time(night.from, 'Quiet hours start', 'from'), h('span', {}, 'to'), time(night.to, 'Quiet hours end', 'to')),
      h('p', { class: 'hint' }, 'A touch brings the display back to full brightness for two minutes. A screen you’ve pinned stays on through the night.'));
  }
  return [pageHead('Night', 'What happens after sunset and overnight.'), c];
}

export const MOTION_LABELS: Record<MotionLevel, [string, string]> = {
  full: ['Full', 'Letters flip, photos drift, the radar pings when new planes arrive.'],
  gentle: ['Gentle', 'Changes fade softly. Nothing flips, drifts or pings.'],
  still: ['Still', 'No animation at all. Only the aircraft keep moving, because that’s live data.'],
};

export function motionPage() {
  const d = displaySettings();
  return [pageHead('Motion', 'How much the screens move.'),
    card(null, choiceList('motion-level', 'Motion', MOTION_LEVELS.map(m => [m, ...MOTION_LABELS[m]] as [MotionLevel, string, string]), d.motion ?? DEFAULT_DISPLAY.motion,
      motion => quietly(saveDisplay({ ...d, motion }))),
    h('p', { class: 'hint' }, 'A tablet set to “Reduce Motion” in its accessibility settings never goes above Gentle.'))];
}

/** Things about the hub that aren't set up, for the This hub row. */
export function hubProblems() {
  const s = state.status;
  return [!s.kv, !s.displayPairing].filter(Boolean).length;
}

export function aboutPage() {
  const s = state.status;
  const item = (ok: boolean, title: string, detail: Node | string) =>
    h('li', { class: ok ? 'ok' : 'todo' }, h('span', { class: 'mark' }, svg(ok ? '<path d="m6 12.5 4 4 8-9"/>' : '<path d="M12 6.5v6.5M12 17.5h.01"/>', 14)), h('div', {}, h('b', {}, title), h('div', { class: 'detail' }, detail)));
  // In the app everything lives on this device: nothing to bind, pair or sign out of.
  if (IN_APP) return [pageHead('This hub'), card(null,
    h('ul', { class: 'checklist' },
      item(true, 'Settings storage', 'Kept on this device.'),
      item(true, 'Photo storage', 'Kept on this device, ready for the photo frame.'),
    )), card('Data sources', h('ul', { class: 'credits' },
      ...APP_CREDITS.map(([what, who]) => h('li', {}, h('b', {}, what), ' ', who)))),
    card('Privacy', h('p', { class: 'hint' }, 'Nothing is collected. Settings, calendars, photos and sign-ins stay on this iPad; it asks the services above directly, sending only a location rounded to about 1 km.'))];
  return [pageHead('This hub'), card(null,
    h('ul', { class: 'checklist' },
      item(s.kv, 'Settings storage', s.kv ? 'KV namespace connected.' : 'No KV namespace bound. Run npm run setup.'),
      item(!!s.displayPairing, 'Add another screen', s.displayPairing
        ? h('div', {}, h('p', {}, 'Open the hub’s address on the other device and sign in with the admin password. Or, to let someone use a screen without the admin password, send them this link instead. Anyone with it can view the hub, so treat it like a password.'), copyRow(s.displayPairing, 'Copy link'))
        : 'DISPLAY_TOKEN is not set. Run npm run setup.'),
      item(s.photos, 'Photo storage', s.photos ? 'R2 bucket connected, ready for the photo frame.' : 'No R2 bucket yet. Optional: the photo frame needs it.'),
    )), signOut()];
}

/** Shown in the app, which has no README beside it. Keep in step with README › Data sources. */
const APP_CREDITS: Array<[string, string]> = [
  ['Aircraft:', 'adsb.lol (ODbL), community-fed ADS-B.'],
  ['Routes and aircraft details:', 'adsbdb, with photos from airport-data.com.'],
  ['Weather, air quality, tides and place search:', 'Open-Meteo (CC BY 4.0). Tides are a guide, not for navigation.'],
  ['Rain radar:', 'RainViewer.'],
  ['Maps:', '© OpenStreetMap contributors; satellite: Sentinel-2 cloudless by EOX (Copernicus data).'],
  ['Aurora:', 'NOAA Space Weather Prediction Center.'],
  ['Space Station:', 'CelesTrak orbits, satellite.js; crew from the people-in-space list; NASA Blue Marble.'],
  ['Airports and towns:', 'OurAirports (public domain), GeoNames (CC BY 4.0).'],
  ['Article of the day and aircraft types:', 'Wikipedia (CC BY-SA).'],
  ['Calendar parsing:', 'ical.js (MPL-2.0). Font: Gabarito (SIL OFL).'],
];

function signOut() {
  const b = h('button', { type: 'button', class: 'row-button danger' }, 'Sign out');
  b.addEventListener('click', () => busy(b, async () => {
    await api('/api/admin/logout', {}).catch(() => {});
    location.replace('/setup');
  }));
  return h('div', { class: 'rows' }, b);
}
