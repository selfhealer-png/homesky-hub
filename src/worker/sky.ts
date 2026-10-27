import { DEFAULT_ALERTS } from '../shared/notable';
import { DEFAULT_DISPLAY, DEFAULT_NIGHT, DEFAULT_RADAR_MAP, MAX_AIRPORTS } from '../shared/settings';
import { screenOrder } from '../shared/rotation';
import type { HubConfig, BoardTheme } from '../shared/types';
import type { Env } from './env';
import { listPhotos } from './photos';
import { loadSettings } from './settings';

// Where the sky and weather screens are centred. In order:
//   1. coordinates the display sends (its own GPS / Wi-Fi location, or a place it switched to)
//   2. the active saved place from /setup
//   3. HOME_LAT/HOME_LON, if the deployment set them
//   4. roughly where the request's internet connection is (Cloudflare's IP location, city level)
// With nothing configured, a display asks for its own location and, if that's refused, the
// hub still works from the IP estimate.

export interface SkyContext { home: { lat: number; lon: number }; radiusNm: number }
interface Home { lat: number; lon: number; name: string }

// Two decimal places (~1 km): enough for a radar, and it keeps the shared cache effective.
const round = (v: number) => Math.round(v * 100) / 100;

function envHome(env: Env): Home | null {
  if (!env.HOME_LAT || !env.HOME_LON) return null;
  const lat = Number(env.HOME_LAT), lon = Number(env.HOME_LON);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, name: 'Home' } : null;
}

function ipHome(request?: Request): Home | null {
  const cf = request?.cf as { latitude?: string; longitude?: string; city?: string } | undefined;
  const lat = Number(cf?.latitude), lon = Number(cf?.longitude);
  if (!cf?.latitude || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: round(lat), lon: round(lon), name: cf.city || 'Near you' };
}

export async function skyContext(env: Env, url?: URL, request?: Request): Promise<SkyContext> {
  const settings = await loadSettings(env);
  const radiusNm = Math.min(250, Math.max(1, settings.sky?.radiusNm ?? Number(env.RADAR_RADIUS_NM ?? 25)));

  const qLat = Number(url?.searchParams.get('lat'));
  const qLon = Number(url?.searchParams.get('lon'));
  if (url?.searchParams.has('lat') && Number.isFinite(qLat) && Number.isFinite(qLon) && Math.abs(qLat) <= 90 && Math.abs(qLon) <= 180) {
    return { home: { lat: round(qLat), lon: round(qLon) }, radiusNm };
  }
  const place = settings.sky?.places.find(p => p.id === settings.sky?.active);
  if (place) return { home: { lat: place.lat, lon: place.lon }, radiusNm };

  const fallback = envHome(env) ?? ipHome(request);
  if (!fallback) throw new Error('No location yet. Allow location on the display, or add a place in /setup.');
  return { home: { lat: fallback.lat, lon: fallback.lon }, radiusNm };
}

export async function hubConfig(env: Env, request?: Request): Promise<HubConfig> {
  const settings = await loadSettings(env);
  const sky = settings.sky;
  const active = sky?.places.find(p => p.id === sky.active);
  const fallback = envHome(env) ?? ipHome(request) ?? { lat: 0, lon: 0, name: 'Unknown' };
  return {
    home: active ? { lat: active.lat, lon: active.lon, name: active.name } : fallback,
    places: sky?.places ?? [],
    // Nothing chosen: each display uses its own location, unless the deployment pinned one.
    activePlace: sky?.active ?? (envHome(env) ? 'default' : 'device'),
    radarRadiusNm: sky?.radiusNm ?? Number(env.RADAR_RADIUS_NM ?? 25),
    radarMap: sky?.map ?? DEFAULT_RADAR_MAP,
    timezone: env.TIMEZONE ?? 'UTC',
    boardTheme: (['splitflap', 'led', 'minimal'] as const).includes(env.BOARD_THEME as BoardTheme) ? env.BOARD_THEME as BoardTheme : 'splitflap',
    clock: settings.display?.clock ?? DEFAULT_DISPLAY.clock,
    motion: settings.display?.motion ?? DEFAULT_DISPLAY.motion,
    warmth: settings.display?.warmth ?? 'normal',
    photoStyle: settings.display?.photoStyle ?? 'fill',
    airports: (sky?.airports ?? []).slice(0, MAX_AIRPORTS),
    night: settings.display?.night ?? DEFAULT_NIGHT,
    wikiPictures: settings.display?.wikiPictures ?? true,
    screensOff: settings.display?.screensOff ?? [],
    order: screenOrder(settings.display?.order),
    rotateSec: settings.display?.rotateSec ?? null,
    stripClock: settings.display?.stripClock ?? false,
    follow: sky?.follow ?? null,
    tidePlace: sky?.tidePlace ?? null,
    alerts: sky?.alerts ?? DEFAULT_ALERTS,
    alertSound: sky?.alertSound ?? false,
    features: { agenda: !!env.AGENDA_FEED_URL || settings.connections.some(c => c.enabled), photos: (await listPhotos(env)).length > 0, trending: false },
  };
}
