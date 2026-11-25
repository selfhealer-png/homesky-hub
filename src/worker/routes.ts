import type { Aircraft, AirlineBrand, Airport, RouteInfo } from '../shared/types';
import { greatCircleKm, routeMisfit } from '../shared/routeCheck';
import { cached } from './cache';
import { USER_AGENT, type Env } from './env';

// Callsign → airline + origin/destination, from adsbdb.com. Routes are looked up by callsign,
// and callsigns get reused across different flights, so a route is only trusted if the aircraft
// is plausibly flying it right now (see routeMisfit).

interface AdsbdbAirport {
  iata_code: string; icao_code: string; name: string; municipality: string;
  country_name: string; latitude: number; longitude: number;
}
interface AdsbdbResponse {
  response: string | {
    flightroute?: {
      callsign_iata?: string;
      airline?: { name: string; icao: string; iata: string };
      origin: AdsbdbAirport;
      destination: AdsbdbAirport;
    };
  };
}

/** A route as looked up. `stops` lists every airport in order when the flight number has more
 *  than one leg (LHR-EDI-LHR); the leg the aircraft is on is picked when it's shown. */
type StoredRoute = Omit<RouteInfo, 'flownKm' | 'remainingKm' | 'progress'> & { stops?: Airport[] };

const toAirport = (a: AdsbdbAirport): Airport => ({
  iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_name, lat: a.latitude, lon: a.longitude,
});

// The second source: the Virtual Radar Server standing data that adsb.lol publishes as static
// files (cached by Cloudflare, no rate limit). It knows many callsigns adsbdb doesn't, like the
// BA Shuttle's (SHT8Y: Heathrow to Edinburgh).
interface VrsAirport { name: string; icao: string; iata?: string; location?: string; countryiso2?: string; lat: number; lon: number }
interface VrsRoute { airline_code?: string; _airports?: VrsAirport[] }

async function fetchVrsRoute(callsign: string): Promise<StoredRoute | null> {
  const cs = callsign.toUpperCase();
  const res = await fetch(`https://vrs-standing-data.adsb.lol/routes/${cs.slice(0, 2)}/${encodeURIComponent(cs)}.json`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  // Unknown callsigns come back as 404 or 503: either way, no route.
  if (!res.ok) return null;
  const body = (await res.json()) as VrsRoute;
  const stops = (body._airports ?? []).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon)).map((a): Airport => ({
    iata: a.iata ?? '', icao: a.icao, name: a.name, city: a.location ?? a.name, country: a.countryiso2 ?? '', lat: a.lat, lon: a.lon,
  }));
  if (stops.length < 2) return null;
  return { flightNumber: null, airline: null, origin: stops[0], destination: stops[stops.length - 1], ...(stops.length > 2 ? { stops } : {}) };
}

async function fetchRoute(callsign: string): Promise<StoredRoute | null> {
  return (await fetchAdsbdbRoute(callsign)) ?? (await fetchVrsRoute(callsign).catch(() => null));
}

async function fetchAdsbdbRoute(callsign: string): Promise<StoredRoute | null> {
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null; // unknown callsign: cache the miss
  if (!res.ok) throw new Error(`adsbdb answered ${res.status}`);
  const body = (await res.json()) as AdsbdbResponse;
  const route = typeof body.response === 'object' ? body.response.flightroute : undefined;
  if (!route) return null;
  return {
    flightNumber: route.callsign_iata ?? null,
    airline: route.airline ? { name: route.airline.name, icao: route.airline.icao, iata: route.airline.iata } : null,
    origin: toAirport(route.origin),
    destination: toAirport(route.destination),
  };
}


/**
 * Looks up a callsign. Lookup failures resolve to null rather than failing the whole request.
 * With a budget, only that many lookups go to adsbdb; cached answers don't count against it.
 */
export async function lookupRoute(env: Env, callsign: string, budget?: { fetches: number }): Promise<StoredRoute | null> {
  const key = `route:v2:${callsign.toUpperCase()}`;
  let route: StoredRoute | null;
  try {
    // Misses are cached too, but only for 6 h, in case the database learns the callsign.
    route = await cached<StoredRoute | null>(env, key, r => (r ? 24 * 3600 : 6 * 3600), () => {
      if (budget && budget.fetches-- <= 0) throw new Error('Out of lookups for this request');
      return fetchRoute(callsign);
    });
  } catch {
    return null;
  }
  if (!route) return null;
  // The airline as people know it: from the callsign when the route has none, sub-brands under
  // their main airline (so every screen shows the same name and logo).
  const brand = await airlineFor(env, callsign, route.airline);
  const icao = route.airline?.icao || callsignAirline(callsign) || '';
  return { ...route, airline: brand ? { name: brand.name, icao, iata: brand.iata ?? '' } : null };
}

/** Adds progress figures, or returns null if the aircraft can't be on this route (see routeMisfit).
 *  For a route with stops, it's the first leg the aircraft could be flying. */
export function withProgress(route: StoredRoute, ac: Aircraft): RouteInfo | null {
  const { stops, ...rest } = route;
  if (stops && stops.length > 2) {
    for (let i = 0; i < stops.length - 1; i++) {
      const leg = withProgress({ ...rest, origin: stops[i], destination: stops[i + 1] }, ac);
      if (leg) return leg;
    }
    return null;
  }
  const { origin: o, destination: d } = route;
  if (routeMisfit(ac, o, d)) return null;
  const flown = greatCircleKm(o.lat, o.lon, ac.lat, ac.lon);
  const remaining = greatCircleKm(ac.lat, ac.lon, d.lat, d.lon);
  return { ...rest, flownKm: flown, remainingKm: remaining, progress: Math.min(1, Math.max(0, flown / (flown + remaining))) };
}

/**
 * Sub-brands and regional arms, shown under the airline people know, with its logo. adsbdb has
 * them as airlines of their own (BA CityFlyer, "CJ") that often have no logo, or leaves the
 * airline off the route altogether (SHT9B, the BA Shuttle).
 */
const BRANDS: Record<string, AirlineBrand> = {
  BAW: { name: 'British Airways', iata: 'BA' },
  SHT: { name: 'British Airways', iata: 'BA' }, // BA Shuttle (UK domestic)
  CFE: { name: 'British Airways', iata: 'BA' }, // BA CityFlyer
  EFW: { name: 'British Airways', iata: 'BA' }, // BA Euroflyer
  EJU: { name: 'easyJet', iata: 'U2' }, // easyJet Europe
  EZS: { name: 'easyJet', iata: 'U2' }, // easyJet Switzerland
  RUK: { name: 'Ryanair', iata: 'FR' }, // Ryanair UK
  RYS: { name: 'Ryanair', iata: 'FR' }, // Buzz
  LOG: { name: 'Loganair', iata: 'LM' },
  KLC: { name: 'KLM', iata: 'KL' }, // KLM Cityhopper
  CLH: { name: 'Lufthansa', iata: 'LH' }, // Lufthansa CityLine
  HOP: { name: 'Air France', iata: 'AF' }, // Air France Hop
  IBS: { name: 'Iberia', iata: 'IB' }, // Iberia Express
  NSZ: { name: 'Norwegian', iata: 'DY' },
  NOZ: { name: 'Norwegian', iata: 'DY' },
  NAX: { name: 'Norwegian', iata: 'DY' },
  WUK: { name: 'Wizz Air', iata: 'W6' }, // Wizz Air UK
  WMT: { name: 'Wizz Air', iata: 'W6' }, // Wizz Air Malta
  WAZ: { name: 'Wizz Air', iata: 'W6' }, // Wizz Air Abu Dhabi
  WZZ: { name: 'Wizz Air', iata: 'W6' },
  EAI: { name: 'Aer Lingus', iata: 'EI' }, // Aer Lingus Regional (Emerald)
  EIN: { name: 'Aer Lingus', iata: 'EI' },
  EXS: { name: 'Jet2', iata: 'LS' },
  TFL: { name: 'TUI', iata: 'OR' },
  TOM: { name: 'TUI', iata: 'BY' },
  JAF: { name: 'TUI', iata: 'TB' },
  TUI: { name: 'TUI', iata: 'X3' },
  CNO: { name: 'SAS', iata: 'SK' }, // SAS Connect
  SZS: { name: 'SAS', iata: 'SK' }, // SAS Link
  SAS: { name: 'SAS', iata: 'SK' },
  PGA: { name: 'TAP Air Portugal', iata: 'TP' }, // TAP Express (Portugália)
  LHX: { name: 'Lufthansa', iata: 'LH' }, // Lufthansa City Airlines
  DLA: { name: 'Lufthansa', iata: 'LH' }, // Air Dolomiti
  EWG: { name: 'Eurowings', iata: 'EW' },
  EWL: { name: 'Eurowings', iata: 'EW' }, // Eurowings Europe
  OCN: { name: 'Lufthansa', iata: 'LH' }, // Discover Airlines
  SWR: { name: 'Swiss', iata: 'LX' },
  EDW: { name: 'Swiss', iata: 'LX' }, // Edelweiss
  AUA: { name: 'Austrian', iata: 'OS' },
  BEL: { name: 'Brussels Airlines', iata: 'SN' },
  VLG: { name: 'Vueling', iata: 'VY' },
  TVS: { name: 'Smartwings', iata: 'QS' },
  TRA: { name: 'Transavia', iata: 'HV' },
  TVF: { name: 'Transavia', iata: 'TO' }, // Transavia France
  QTR: { name: 'Qatar Airways', iata: 'QR' },
  UAE: { name: 'Emirates', iata: 'EK' },
  ETD: { name: 'Etihad', iata: 'EY' },
  VIR: { name: 'Virgin Atlantic', iata: 'VS' },
  AAL: { name: 'American Airlines', iata: 'AA' },
  UAL: { name: 'United', iata: 'UA' },
  DAL: { name: 'Delta', iata: 'DL' },
  ACA: { name: 'Air Canada', iata: 'AC' },
  ROU: { name: 'Air Canada', iata: 'AC' }, // Air Canada Rouge
  THY: { name: 'Turkish Airlines', iata: 'TK' },
  PGT: { name: 'Pegasus', iata: 'PC' },
};

/** The ICAO airline code a callsign starts with (BAW117 → BAW), or null for registrations. */
export const callsignAirline = (callsign: string): string | null => callsign.toUpperCase().match(/^([A-Z]{3})\d/)?.[1] ?? null;

/**
 * The airline to show for a callsign: the route's airline when it has one, else the airline its
 * three-letter code belongs to (from adsbdb, cached a month), with sub-brands under their main
 * airline. Null for private flights and when nobody knows.
 */
export async function airlineFor(env: Env, callsign: string, fromRoute: { name: string; icao: string; iata: string } | null): Promise<AirlineBrand | null> {
  const code = fromRoute?.icao || callsignAirline(callsign);
  if (code && BRANDS[code]) return BRANDS[code];
  if (fromRoute) return { name: fromRoute.name, iata: fromRoute.iata || null };
  if (!code) return null;
  try {
    return await cached<AirlineBrand | null>(env, `airline:icao:v1:${code}`, v => (v ? 30 * 86_400 : 7 * 86_400), async () => {
      const res = await fetch(`https://api.adsbdb.com/v0/airline/${code}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`adsbdb answered ${res.status}`);
      const body = (await res.json()) as { response: string | Array<{ name?: string; icao?: string; iata?: string | null }> };
      const hit = Array.isArray(body.response) ? body.response.find(a => a.icao === code && a.name) : undefined;
      return hit ? { name: hit.name!, iata: hit.iata || null } : null;
    });
  } catch {
    return null;
  }
}
