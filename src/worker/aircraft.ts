import type { Aircraft, AircraftResponse, RouteSummary, TrailPoint } from '../shared/types';
import { cached } from './cache';
import { allowedSources, json, USER_AGENT, type Env } from './env';
import { lookupRoute, withProgress } from './routes';
import { skyContext, type SkyContext } from './sky';

// Free, community-fed ADS-B sources, tried in order. A local receiver, if configured, goes first.
//
// These services rate-limit or block traffic from shared cloud addresses (and a Worker's
// requests come from Cloudflare's), so the hub is careful with them: a source that refuses is
// left alone for a while instead of being asked again every few seconds, the order puts the
// most tolerant first, and if every source fails briefly the last good positions are served
// (marked stale) so the screens don't go blank.
interface Provider { name: string; url: (lat: number, lon: number, nm: number) => string; parse?: (body: unknown) => ReadsbAircraft[] }

const PUBLIC_PROVIDERS: Provider[] = [
  { name: 'adsb.lol', url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}` },
  { name: 'adsb.fi', url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
  { name: 'airplanes.live', url: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}` },
];

export const CACHE_SECONDS = 8;
const STALE_OK_MS = 90_000; // serve the last good positions this long if every source fails

/** Sources that refused recently, and until when to leave them alone (per Worker isolate). */
const restingUntil = new Map<string, number>();
const lastGood = new Map<string, AircraftResponse>();

class SourceRefused extends Error {
  constructor(message: string, public restSeconds: number) { super(message); }
}
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

export interface ReadsbAircraft {
  hex: string; flight?: string; r?: string; t?: string;
  lat?: number; lon?: number; alt_baro?: number | 'ground'; gs?: number; track?: number;
  baro_rate?: number; geom_rate?: number; squawk?: string; emergency?: string;
  // From the feed's aircraft database. dbFlags: 1 military, 2 interesting, 4 PIA, 8 LADD.
  desc?: string; dbFlags?: number; ownOp?: string; year?: string | number; category?: string;
  // What the aircraft reports about itself, when it does.
  ias?: number; tas?: number; mach?: number; nav_altitude_mcp?: number; nav_heading?: number; nav_modes?: string[];
  roll?: number; wd?: number; ws?: number; oat?: number;
  /** How the position was found: adsb_icao, mlat, tisb_icao and so on. */
  type?: string;
}

/** PIA and LADD: owners who asked for their aircraft not to be singled out. */
const PRIVATE_FLAGS = 4 | 8;

/** ICAO address blocks kept for military aircraft, for feeds that don't send the military flag:
 *  the United States and the United Kingdom, which between them fly most of what's seen. */
const MILITARY_BLOCKS: Array<[number, number]> = [[0xae0000, 0xafffff], [0x43c000, 0x43cfff]];
const inMilitaryBlock = (hex: string) => {
  const n = parseInt(hex, 16);
  return MILITARY_BLOCKS.some(([lo, hi]) => n >= lo && n <= hi);
};

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

export function normalize(raw: ReadsbAircraft, lat0: number, lon0: number): Aircraft | null {
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
  const squawk = raw.squawk ?? null;
  const flags = raw.dbFlags ?? 0;
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
    desc: raw.desc?.trim() || null,
    military: (!!(flags & 1) || (raw.dbFlags === undefined && inMilitaryBlock(raw.hex))) && !(flags & PRIVATE_FLAGS),
    interesting: !!(flags & 2) && !(flags & PRIVATE_FLAGS),
    category: raw.category ?? null,
    onGround: raw.alt_baro === 'ground',
  };
}

async function fetchProvider(name: string, url: string, parse?: Provider['parse']): Promise<ReadsbAircraft[]> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
  if (res.status === 429) {
    // "Too many requests": wait as long as the source asks, else a minute.
    const wait = Number(res.headers.get('retry-after') ?? res.headers.get('x-rate-limit-retry-after-seconds'));
    throw new SourceRefused(`${name} answered 429`, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 3600) : 60);
  }
  if (res.status === 403) throw new SourceRefused(`${name} answered 403`, 600);
  if (!res.ok) throw new SourceRefused(`${name} answered ${res.status}`, 30);
  const body = await res.json();
  if (parse) return parse(body);
  const b = body as { ac?: ReadsbAircraft[]; aircraft?: ReadsbAircraft[] };
  return b.ac ?? b.aircraft ?? [];
}

export class AircraftUnavailable extends Error {
  constructor(public details: string[]) { super('All aircraft sources failed'); }
}

/** Where to remember which sources are resting and the last good positions. */
export interface SourceMemory {
  restingUntil: Map<string, number>;
  lastGood: Map<string, AircraftResponse>;
  /** Longest pause after "too many requests", in seconds (the shared fetcher keeps it short). */
  max429Rest?: number;
}

export const aircraftKey = (lat: number, lon: number, nm: number) => `aircraft:${lat}:${lon}:${nm}`;

/**
 * Asks the sources in turn and returns the first good answer. Falls back to the last good
 * positions (marked stale) for a short while if every source fails.
 */
export async function fetchFromSources(env: Env, lat: number, lon: number, nm: number, memory: SourceMemory): Promise<AircraftResponse> {
  const { restingUntil, lastGood } = memory;
  const key = aircraftKey(lat, lon, nm);
  {
    const attempts: Array<[string, string, Provider['parse']]> = [];
    if (env.LOCAL_ADSB_URL) attempts.push(['local', `${env.LOCAL_ADSB_URL.replace(/\/$/, '')}/data/aircraft.json`, undefined]);
    for (const p of allowedSources(env, PUBLIC_PROVIDERS)) attempts.push([p.name, p.url(lat, lon, nm), p.parse]);

    const errors: string[] = [];
    for (const [name, url, parse] of attempts) {
      if ((restingUntil.get(name) ?? 0) > Date.now()) {
        errors.push(`${name}: resting after an earlier refusal`);
        continue;
      }
      try {
        const list = await fetchProvider(name, url, parse);
        const aircraft = list
          .map(a => normalize(a, lat, lon))
          .filter((a): a is Aircraft => !!a && a.distanceNm <= nm)
          .sort((a, b) => a.distanceNm - b.distanceNm);
        const result: AircraftResponse = { source: name, fetchedAt: Date.now(), aircraft };
        lastGood.set(key, result);
        return result;
      } catch (err) {
        // Refused, or no answer in time: leave it alone a while.
        let rest = err instanceof SourceRefused ? err.restSeconds : (err as Error).name === 'TimeoutError' ? 600 : 30;
        if (memory.max429Rest && (err as Error).message.endsWith('429')) rest = Math.min(rest, memory.max429Rest);
        if (name !== 'local') restingUntil.set(name, Date.now() + rest * 1000);
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }
    // Everything failed: better slightly old positions (the display moves them along their
    // track) than an empty radar, for a short while.
    const previous = lastGood.get(key);
    if (previous && Date.now() - previous.fetchedAt < STALE_OK_MS) return { ...previous, stale: true };
    throw new AircraftUnavailable(errors);
  }
}

const isolateMemory: SourceMemory = { restingUntil, lastGood };

/**
 * Live aircraft within the sky radius of a centre point, nearest first. Shared by every sky screen.
 *
 * Two layers, because the free sources limit requests per address:
 *   1. The shared fetcher (the SKY Durable Object). Fresh positions there are used by every
 *      screen on every device, so the hub asks the sources far less often.
 *   2. If the shared fetcher was refused, this Worker tries the sources itself. It runs in a
 *      different Cloudflare location with different addresses, which often get through when the
 *      shared fetcher's don't. A good result is handed back to the shared fetcher for everyone.
 * Without the SKY binding, only layer 2 runs.
 */
export async function getAircraft(env: Env, sky: SkyContext): Promise<AircraftResponse> {
  const { lat, lon } = sky.home;
  const nm = sky.radiusNm;
  const local = () => cached(env, aircraftKey(lat, lon, nm), CACHE_SECONDS, () => fetchFromSources(env, lat, lon, nm, isolateMemory));
  if (!env.SKY) return local();

  const shared = env.SKY.get(env.SKY.idFromName('shared'));
  // RPC types turn tuples into plain arrays; the shapes are the same.
  const result = (await shared.aircraft(lat, lon, nm)) as AircraftResponse | { error: string; details: string[] };
  if (!('error' in result) && !result.stale) return result;

  try {
    const mine = await local();
    if (!mine.stale) await shared.offer(lat, lon, nm, mine);
    return mine;
  } catch (err) {
    // Neither got through: the shared fetcher's last good positions are better than nothing.
    if (!('error' in result)) return result;
    throw err;
  }
}

/** Where the aircraft in `data` have been lately, from the shared fetcher's memory of recent answers. */
async function trailsFor(env: Env, sky: SkyContext, data: AircraftResponse): Promise<Record<string, TrailPoint[]>> {
  if (!env.SKY) return {};
  const all = (await env.SKY.get(env.SKY.idFromName('shared')).trails(sky.home.lat, sky.home.lon, sky.radiusNm).catch(() => ({}))) as Record<string, TrailPoint[]>;
  const out: Record<string, TrailPoint[]> = {};
  for (const a of data.aircraft) if (all[a.hex]?.length) out[a.hex] = all[a.hex];
  return out;
}

export async function handleAircraft(env: Env, url: URL, request: Request): Promise<Response> {
  try {
    const sky = await skyContext(env, url, request);
    let data = await getAircraft(env, sky);
    // ?trails=1 (a screen just opened) adds where each plane has been, so its trail is there at once.
    if (url.searchParams.get('trails') === '1') data = { ...data, trails: await trailsFor(env, sky, data) };
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
      if (r) {
        routes[a.hex] = {
          from: r.origin.iata || r.origin.icao, to: r.destination.iata || r.destination.icao, fromCity: r.origin.city, toCity: r.destination.city,
          airline: r.airline?.name ?? null, airlineIata: r.airline?.iata || null,
          toLat: r.destination.lat, toLon: r.destination.lon, remainingKm: Math.round(r.remainingKm),
        };
      }
    }));
    return json({ ...data, routes } satisfies AircraftResponse);
  } catch (err) {
    return json({ error: (err as Error).message, details: (err as AircraftUnavailable).details }, { status: 502 });
  }
}
