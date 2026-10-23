// Settings chosen in /setup, stored in KV. Anything secret (calendar links, tokens, OAuth
// credentials) is not in here: it lives in a separate encrypted blob, keyed by `secretKey`.

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

export interface GoogleConnection {
  id: 'google'; kind: 'google'; enabled: boolean;
  clientId: string;
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
}

export interface Settings {
  version: 1;
  connections: Connection[];
  sky?: SkySettings;
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
}

export type PickStatus =
  | { state: 'waiting'; pollMs: number }
  | { state: 'importing'; imported: number; total: number }
  | { state: 'done'; imported: number; skipped: number }
  | { state: 'expired' };

/** Colours offered for calendars: the household board's palette plus a few extras. */
export const CALENDAR_COLORS = ['#2563FF', '#7C3AED', '#94A3B8', '#2e9d6e', '#F59E0B', '#E11D48', '#0EA5E9', '#D946EF'];
