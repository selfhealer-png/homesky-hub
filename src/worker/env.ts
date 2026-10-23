export interface Env {
  ASSETS: Fetcher;
  HOME_LAT: string;
  HOME_LON: string;
  RADAR_RADIUS_NM?: string;
  TIMEZONE?: string;
  LOCAL_ADSB_URL?: string;
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
