export interface Env {
  ASSETS: Fetcher;
  HOME_LAT: string;
  HOME_LON: string;
  RADAR_RADIUS_NM?: string;
  TIMEZONE?: string;
  LOCAL_ADSB_URL?: string;
  /** Comma-separated names of the public ADS-B sources to use, tried in that order (default: all).
   *  The iOS app keeps to adsb.lol, whose ODbL licence covers a distributed app; the others' terms are personal use. */
  AIRCRAFT_SOURCES?: string;
  /** Optional relay for the public ADS-B feeds (relay/adsb-relay.mjs, docs/RELAY.md): a server with
   *  an address of its own, for when the feeds refuse Cloudflare's shared addresses. */
  ADSB_RELAY_URL?: string;
  ADSB_RELAY_TOKEN?: string;
  ALLOW_OPEN?: string;
  DISPLAY_TOKEN?: string;
  AGENDA_FEED_URL?: string;
  AGENDA_FEED_TOKEN?: string;
  BOARD_RADIUS_NM?: string;
  BOARD_MIN_ALT_FT?: string;
  BOARD_AIRLINERS_ONLY?: string;
  BOARD_THEME?: string;
  HUB_KV?: KVNamespace;
  PHOTOS?: R2Bucket;
  SKY?: DurableObjectNamespace<import('./skyFetcher').SkyFetcher>;
  ADMIN_PASSWORD?: string;
  /** Only in the iOS app: its own Google OAuth client (an iOS client: no secret, PKCE). */
  GOOGLE_IOS_CLIENT_ID?: string;
  /** Only in the iOS app: the iPad's own calendars, reminders and photo albums (shared/device.ts). */
  DEVICE?: import('../shared/device').DeviceBinding;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  // new Headers() keeps every entry, including repeated Set-Cookie headers, whether init.headers
  // is a plain object or a Headers instance (spreading a Headers instance copies nothing).
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const USER_AGENT = 'homesky-hub/0.1';

/** The ADS-B feed hosts that go through the relay when one is set (the relay allows only these). */
const RELAYED_HOSTS = new Set(['api.adsb.lol', 'opendata.adsb.fi', 'api.airplanes.live']);

/**
 * Fetch for the public ADS-B feeds: straight to the feed, or through the relay when
 * ADSB_RELAY_URL is set (https://relay/<feed host>/<path>, with the relay's token).
 */
export function fetchFeed(env: Env, url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  const relay = env.ADSB_RELAY_URL?.trim().replace(/\/+$/, '');
  const u = new URL(url);
  if (!relay || !RELAYED_HOSTS.has(u.hostname)) return fetch(url, init);
  const headers: Record<string, string> = { ...init.headers };
  if (env.ADSB_RELAY_TOKEN) headers.authorization = `Bearer ${env.ADSB_RELAY_TOKEN}`;
  return fetch(`${relay}/${u.hostname}${u.pathname}${u.search}`, { ...init, headers });
}

/** The public sources this deployment may ask, in the order AIRCRAFT_SOURCES lists them
 *  (default: all, in the built-in order). Unknown names are ignored. */
export function allowedSources<T extends { name: string }>(env: Env, all: T[]): T[] {
  const allow = env.AIRCRAFT_SOURCES?.split(',').map(s => s.trim()).filter(Boolean);
  if (!allow?.length) return all;
  return [...new Set(allow)].map(name => all.find(s => s.name === name)).filter((s): s is T => !!s);
}
