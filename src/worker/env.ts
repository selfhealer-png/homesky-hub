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
  ADMIN_PASSWORD?: string;
}

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...init.headers },
  });

export const USER_AGENT = 'homesky-hub/0.1';
