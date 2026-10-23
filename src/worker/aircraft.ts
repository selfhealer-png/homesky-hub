import type { Aircraft, AircraftResponse, RouteSummary } from '../shared/types';
import { cached } from './cache';
import { json, USER_AGENT, type Env } from './env';
import { lookupRoute, withProgress } from './routes';
import { skyContext, type SkyContext } from './sky';

// Community ADS-B aggregators, tried in order (the same set esp32flight uses). All speak the
// readsb JSON dialect. A local receiver, if configured, goes first.
interface Provider { name: string; url: (lat: number, lon: number, nm: number) => string }

const PUBLIC_PROVIDERS: Provider[] = [
  { name: 'airplanes.live', url: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}` },
  { name: 'adsb.lol', url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}` },
  { name: 'adsb.fi', url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
];

const CACHE_SECONDS = 5;
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

interface ReadsbAircraft {
  hex: string; flight?: string; r?: string; t?: string;
  lat?: number; lon?: number; alt_baro?: number | 'ground'; gs?: number; track?: number;
  baro_rate?: number; geom_rate?: number; squawk?: string; emergency?: string;
}

export function distanceAndBearing(lat0: number, lon0: number, lat: number, lon: number) {
  const toRad = Math.PI / 180;
  const dLat = (lat - lat0) * toRad;
  const dLon = (lon - lon0) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat0 * toRad) * Math.cos(lat * toRad) * Math.sin(dLon / 2) ** 2;
  const distanceNm = 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(dLon) * Math.cos(lat * toRad);
  const x = Math.cos(lat0 * toRad) * Math.sin(lat * toRad) - Math.sin(lat0 * toRad) * Math.cos(lat * toRad) * Math.cos(dLon);
  const bearingDeg = (Math.atan2(y, x) / toRad + 360) % 360;
  return { distanceNm, bearingDeg };
}

function normalize(raw: ReadsbAircraft, lat0: number, lon0: number): Aircraft | null {
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
  const squawk = raw.squawk ?? null;
  return {
    hex: raw.hex,
    callsign: raw.flight?.trim() || null,
    registration: raw.r ?? null,
    type: raw.t ?? null,
    lat: raw.lat,
    lon: raw.lon,
    altFt: typeof raw.alt_baro === 'number' ? raw.alt_baro : null,
    groundSpeedKt: raw.gs ?? null,
    trackDeg: raw.track ?? null,
    verticalRateFpm: raw.baro_rate ?? raw.geom_rate ?? null,
    squawk,
    emergency: (!!raw.emergency && raw.emergency !== 'none') || (!!squawk && EMERGENCY_SQUAWKS.has(squawk)),
    ...distanceAndBearing(lat0, lon0, raw.lat, raw.lon),
  };
}

async function fetchProvider(name: string, url: string): Promise<{ name: string; list: ReadsbAircraft[] }> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  const body = (await res.json()) as { ac?: ReadsbAircraft[]; aircraft?: ReadsbAircraft[] };
  return { name, list: body.ac ?? body.aircraft ?? [] };
}

export class AircraftUnavailable extends Error {
  constructor(public details: string[]) { super('All aircraft sources failed'); }
}

/** Live aircraft within the sky radius of a centre point, nearest first. Shared by every sky screen. */
export function getAircraft(env: Env, sky: SkyContext): Promise<AircraftResponse> {
  const { lat, lon } = sky.home;
  const nm = sky.radiusNm;

  // One upstream call per CACHE_SECONDS per isolate, however many displays or screens poll.
  return cached(env, `aircraft:${lat}:${lon}:${nm}`, CACHE_SECONDS, async () => {
    const attempts: Array<[string, string]> = [];
    if (env.LOCAL_ADSB_URL) attempts.push(['local', `${env.LOCAL_ADSB_URL.replace(/\/$/, '')}/data/aircraft.json`]);
    for (const p of PUBLIC_PROVIDERS) attempts.push([p.name, p.url(lat, lon, nm)]);

    const errors: string[] = [];
    for (const [name, url] of attempts) {
      try {
        const { list } = await fetchProvider(name, url);
        const aircraft = list
          .map(a => normalize(a, lat, lon))
          .filter((a): a is Aircraft => !!a && a.distanceNm <= nm)
          .sort((a, b) => a.distanceNm - b.distanceNm);
        return { source: name, fetchedAt: Date.now(), aircraft };
      } catch (err) {
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }
    throw new AircraftUnavailable(errors);
  });
}

export async function handleAircraft(env: Env, url: URL): Promise<Response> {
  try {
    const data = await getAircraft(env, await skyContext(env, url));
    // ?routes=N adds routes for the N nearest airborne aircraft (plus any emergency).
    // Lookups are cached for 24 h, so this costs nothing after the first sighting.
    const n = Math.min(8, Number(url.searchParams.get('routes') ?? 0));
    if (n <= 0) return json(data);
    const airborne = data.aircraft.filter(a => a.altFt !== null);
    const featured = [...airborne.filter(a => a.emergency), ...airborne.slice(0, n)].filter((a, i, all) => all.indexOf(a) === i);
    const routes: Record<string, RouteSummary> = {};
    await Promise.all(featured.map(async a => {
      const stored = a.callsign ? await lookupRoute(env, a.callsign) : null;
      const r = stored && withProgress(stored, a);
      if (r) routes[a.hex] = { from: r.origin.iata || r.origin.icao, to: r.destination.iata || r.destination.icao, fromCity: r.origin.city, toCity: r.destination.city, airline: r.airline?.name ?? null };
    }));
    return json({ ...data, routes } satisfies AircraftResponse);
  } catch (err) {
    return json({ error: (err as Error).message, details: (err as AircraftUnavailable).details }, { status: 502 });
  }
}
