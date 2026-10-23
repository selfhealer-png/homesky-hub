import { DEFAULT_DISPLAY } from '../shared/settings';
import type { HubConfig, BoardTheme } from '../shared/types';
import type { Env } from './env';
import { loadSettings } from './settings';

// Where the sky screens are centred. In order: coordinates a display sends with its request
// (its own GPS, or a place it switched to), the active saved place from /setup, then the
// deployment's HOME_LAT/HOME_LON.

export interface SkyContext { home: { lat: number; lon: number }; radiusNm: number }

// Two decimal places (~1 km): enough for a radar, and it keeps the shared cache effective.
const round = (v: number) => Math.round(v * 100) / 100;

export async function skyContext(env: Env, url?: URL): Promise<SkyContext> {
  const settings = await loadSettings(env);
  const radiusNm = Math.min(250, Math.max(1, settings.sky?.radiusNm ?? Number(env.RADAR_RADIUS_NM ?? 25)));

  const qLat = Number(url?.searchParams.get('lat'));
  const qLon = Number(url?.searchParams.get('lon'));
  if (url?.searchParams.has('lat') && Number.isFinite(qLat) && Number.isFinite(qLon) && Math.abs(qLat) <= 90 && Math.abs(qLon) <= 180) {
    return { home: { lat: round(qLat), lon: round(qLon) }, radiusNm };
  }
  const place = settings.sky?.places.find(p => p.id === settings.sky?.active);
  if (place) return { home: { lat: place.lat, lon: place.lon }, radiusNm };

  const lat = Number(env.HOME_LAT);
  const lon = Number(env.HOME_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('No location set. Add a place in /setup or set HOME_LAT/HOME_LON.');
  return { home: { lat, lon }, radiusNm };
}

export async function hubConfig(env: Env): Promise<HubConfig> {
  const settings = await loadSettings(env);
  const sky = settings.sky;
  const active = sky?.places.find(p => p.id === sky.active);
  return {
    home: active ? { lat: active.lat, lon: active.lon, name: active.name } : { lat: Number(env.HOME_LAT), lon: Number(env.HOME_LON), name: 'Home' },
    places: sky?.places ?? [],
    activePlace: sky?.active ?? 'default',
    radarRadiusNm: sky?.radiusNm ?? Number(env.RADAR_RADIUS_NM ?? 25),
    timezone: env.TIMEZONE ?? 'UTC',
    boardTheme: (['splitflap', 'led', 'minimal'] as const).includes(env.BOARD_THEME as BoardTheme) ? env.BOARD_THEME as BoardTheme : 'splitflap',
    clock: settings.display?.clock ?? DEFAULT_DISPLAY.clock,
    motion: settings.display?.motion ?? DEFAULT_DISPLAY.motion,
    warmth: settings.display?.warmth ?? 'normal',
    photoStyle: settings.display?.photoStyle ?? 'fill',
    features: { agenda: !!env.AGENDA_FEED_URL || settings.connections.some(c => c.enabled), photos: !!env.PHOTOS, trending: false },
  };
}
