// Settings chosen in /setup, stored in KV. Anything secret (calendar links, tokens, OAuth
// credentials) is not in here: it lives in a separate encrypted blob, keyed by `secretKey`.

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

export interface SkySettings {
  places: Place[];
  /** A place id, or 'device' for each display to use its own location (GPS / Wi-Fi). */
  active: string;
  radiusNm: number;
  /** What's drawn under the radar. Each display can switch its own from the radar screen. */
  map?: RadarMap;
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
  /** fill: edge to edge. framed: prints in a mounted frame, with a small label. */
  photoStyle?: PhotoStyle;
}

export type PhotoStyle = 'fill' | 'framed';
export const PHOTO_STYLES: PhotoStyle[] = ['fill', 'framed'];

export const DEFAULT_DISPLAY: DisplaySettings = { clock: 'word', motion: 'full', warmth: 'normal', photoStyle: 'fill' };
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
