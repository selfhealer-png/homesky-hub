// Settings chosen in /setup, stored in KV. Anything secret (calendar links, tokens, OAuth
// credentials) is not in here: it lives in a separate encrypted blob, keyed by `secretKey`.

import type { AlertLevel } from './notable';
import type { Warmth } from './wear';

export type ConnectionKind = 'ics' | 'feed' | 'google';

export interface IcsConnection {
  id: string; kind: 'ics'; name: string; color: string; enabled: boolean;
  /** Host of the link, safe to show (e.g. "calendar.google.com"). The link itself is secret. */
  host: string;
}

export interface FeedConnection {
  id: string; kind: 'feed'; name: string; enabled: boolean;
  url: string;
  hasToken: boolean;
}

export interface GoogleItem { id: string; name: string; color: string; enabled: boolean }

/** Which parts of Google the hub is used for. Each is asked for, and granted, separately. */
export interface GoogleWants { calendar: boolean; tasks: boolean; photos: boolean }
export type GooglePart = keyof GoogleWants;

export const GOOGLE_SCOPE: Record<GooglePart, string> = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  tasks: 'https://www.googleapis.com/auth/tasks.readonly',
  // Photos Picker: only ever sees photos the person picks themselves.
  photos: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
};

/** Whether Google actually granted a part (connections made before parts existed had all three). */
export const googleGranted = (conn: { scopes?: string[] }, part: GooglePart) => !conn.scopes || conn.scopes.includes(GOOGLE_SCOPE[part]);

export interface GoogleConnection {
  id: 'google'; kind: 'google'; enabled: boolean;
  clientId: string;
  /** What the person chose to use Google for; asked for when connecting. */
  wants?: GoogleWants;
  /** Set once OAuth has completed and a refresh token is stored. */
  account: string | null;
  /** Scopes Google actually granted; photos need the Picker scope. */
  scopes?: string[];
  calendars: GoogleItem[];
  taskLists: GoogleItem[];
}

export type Connection = IcsConnection | FeedConnection | GoogleConnection;

export interface Place { id: string; name: string; lat: number; lon: number }

/** The airport with an arrivals and departures board, chosen in /setup from the OurAirports list. */
export interface SavedAirport { icao: string; iata: string; name: string; city: string; lat: number; lon: number }
/** One board, one airport. Hubs set up when several were allowed keep the first. */
export const MAX_AIRPORTS = 1;

export interface SkySettings {
  places: Place[];
  /** A place id, or 'device' for each display to use its own location (GPS / Wi-Fi). */
  active: string;
  radiusNm: number;
  /** What's drawn under the radar. Each display can switch its own from the radar screen. */
  map?: RadarMap;
  /** Airports with an arrivals and departures board, in the order the display shows them. */
  airports?: SavedAirport[];
  /** The one flight the Flight tracker follows anywhere in the world: a flight number (BA117),
   *  callsign (BAW117), registration (G-XLEA) or ICAO hex code (4CA8B1). */
  follow?: string;
  /** Where the Tides screen reads the tide: a place by the sea, since inland places have none. */
  tidePlace?: Place;
  /** Which aircraft interrupt the display with an alert (default: rare ones and emergencies). */
  alerts?: AlertLevel;
  /** A soft chime with each alert, except at night. Off unless chosen. */
  alertSound?: boolean;
}

export type RadarMap = 'plain' | 'map' | 'satellite';
export const RADAR_MAPS: RadarMap[] = ['plain', 'map', 'satellite'];
export const DEFAULT_RADAR_MAP: RadarMap = 'map';

export type ClockStyle = 'word' | 'digital' | 'analogue' | 'flip';
/** full: every animation. gentle: changes fade instead of flipping or drifting. still: nothing moves but data. */
export type MotionLevel = 'full' | 'gentle' | 'still';

export interface DisplaySettings {
  clock: ClockStyle;
  motion: MotionLevel;
  /** For clothing advice: someone who runs cold is told to dress for colder weather. */
  warmth?: Warmth;
  /** fill: edge to edge. framed: prints in a mounted frame. instant: instant-camera prints
   *  on a table. float: borderless, over a blur of the photo's colours. */
  photoStyle?: PhotoStyle;
  night?: NightSettings;
  /** Show the featured article's picture. Off: words only, for a display children see unsupervised. */
  wikiPictures?: boolean;
  /** Screens the person switched off. A list of what's off, so a screen added later starts on. */
  screensOff?: ScreenId[];
  /** The order screens rotate in, as the person arranged it. Screens missing from it (added in a
   *  later release) slot in after the screen they follow by default. */
  order?: ScreenId[];
  /** Seconds before the display moves to the next screen. Absent: each screen's own pace
   *  (null when saving says "go back to that"). Hubs set up before per-screen timing may have
   *  it; the timing sliders replace it with screenSec. */
  rotateSec?: number | null;
  /** Seconds on each screen, as set on the timing sliders. A screen missing from it keeps
   *  rotateSec, or else its own pace (DEFAULT_SCREEN_SEC). */
  screenSec?: Partial<Record<ScreenId, number>>;
  /** The time in the bottom corner of screens that don't show it themselves. Off unless chosen. */
  stripClock?: boolean;
}

/** How often the display could be set to change screens, in seconds (the one pace for every
 *  screen, from before per-screen timing; still accepted from older setup pages). */
export const ROTATE_CHOICES = [15, 30, 60, 120, 300, 600];

export type ScreenId = 'home' | 'weather' | 'rain' | 'tides' | 'board' | 'radar' | 'airport' | 'flight' | 'tonight' | 'iss' | 'clock' | 'photos' | 'wiki';
/** Every screen, in the default rotation order. */
export const SCREEN_IDS: ScreenId[] = ['home', 'weather', 'rain', 'tides', 'board', 'radar', 'airport', 'flight', 'tonight', 'iss', 'clock', 'photos', 'wiki'];

/** The stops on a timing slider, in seconds: fine steps for short stays, coarser ones up to 15 minutes. */
export const SCREEN_SEC_STEPS = [10, 15, 20, 30, 40, 45, 60, 90, 120, 180, 300, 600, 900];
/** Each screen's own pace: busier screens stay longer. Every value is one of SCREEN_SEC_STEPS. */
export const DEFAULT_SCREEN_SEC: Record<ScreenId, number> = {
  home: 60, weather: 45, rain: 40, tides: 40, board: 60, radar: 60, airport: 60, flight: 60, tonight: 40, iss: 45, clock: 45, photos: 90, wiki: 40,
};
/** How long a screen stays up: its own setting, else the old one pace for all, else its default. */
export const screenSeconds = (id: ScreenId, d: { screenSec?: Partial<Record<ScreenId, number>> | null; rotateSec?: number | null }) =>
  d.screenSec?.[id] ?? d.rotateSec ?? DEFAULT_SCREEN_SEC[id];

/** What the Flight tracker accepts, as typed in /setup: spaces dropped, then (isFollow) up to ten
 *  letters, digits and dashes. Nothing is cut off, so a typo is refused rather than half-saved. */
export const cleanFollow = (v: unknown) => typeof v === 'string' ? v.toUpperCase().replace(/\s+/g, '') : '';
export const isFollow = (v: string) => /^[A-Z0-9][A-Z0-9-]{2,9}$/.test(v);

export type PhotoStyle = 'fill' | 'framed' | 'instant' | 'float';
export const PHOTO_STYLES: PhotoStyle[] = ['fill', 'framed', 'instant', 'float'];

/** quiet: bright screens go dark from sunset, and in quiet hours the display also dims and shows
 *  only the clock, Home and Tonight. evening: only the sunset part. off: the same all day. */
export type NightMode = 'quiet' | 'evening' | 'off';
export const NIGHT_MODES: NightMode[] = ['quiet', 'evening', 'off'];
/** Quiet hours as "HH:MM" in the hub's timezone; they can run past midnight. */
export interface NightSettings { mode: NightMode; from: string; to: string }
export const DEFAULT_NIGHT: NightSettings = { mode: 'quiet', from: '22:30', to: '06:30' };
export const isClockTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const DEFAULT_DISPLAY: DisplaySettings = { clock: 'word', motion: 'full', warmth: 'normal', photoStyle: 'fill', night: DEFAULT_NIGHT };
export const WARMTH_LEVELS: Warmth[] = ['cold', 'normal', 'warm'];
export const CLOCK_STYLES: ClockStyle[] = ['word', 'digital', 'analogue', 'flip'];
export const MOTION_LEVELS: MotionLevel[] = ['full', 'gentle', 'still'];

export interface Settings {
  version: 1;
  connections: Connection[];
  sky?: SkySettings;
  display?: DisplaySettings;
}

export const EMPTY_SETTINGS: Settings = { version: 1, connections: [] };

export const RADIUS_CHOICES = [10, 15, 25, 40, 60];

export const secretKey = {
  icsUrl: (id: string) => `ics:${id}:url`,
  feedToken: (id: string) => `feed:${id}:token`,
  googleClientSecret: 'google:clientSecret',
  googleRefreshToken: 'google:refreshToken',
};

/** What /api/admin/state returns. */
export interface AdminState {
  settings: Settings;
  status: {
    kv: boolean;
    photos: boolean;
    displayPairing: string | null; // pairing link, if DISPLAY_TOKEN is set
    origin: string;
    googleRedirectUri: string;
    envFeed: boolean; // AGENDA_FEED_URL set as a deployment variable
  };
}

export interface ConnectionTest {
  ok: boolean;
  events: number;
  tasks: number;
  upcoming: string[]; // a few upcoming titles, so the person can see it's the right calendar
  error?: string;
}

export interface PhotoInfo {
  id: string;
  width: number;
  height: number;
  /** When the photo was taken (from Google Photos), ISO 8601. */
  taken: string | null;
  collection: string;
  /** A place or note added in /setup. Google's picker never shares location, so this is typed in. */
  caption: string | null;
}

export type PickStatus =
  | { state: 'waiting'; pollMs: number }
  | { state: 'importing'; imported: number; total: number }
  | { state: 'done'; imported: number; skipped: number }
  | { state: 'expired' };

/** Colours offered for calendars: the household board's palette plus a few extras. */
export const CALENDAR_COLORS = ['#2563FF', '#7C3AED', '#94A3B8', '#2e9d6e', '#F59E0B', '#E11D48', '#0EA5E9', '#D946EF'];
