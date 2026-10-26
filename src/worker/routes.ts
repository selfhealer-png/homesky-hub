import type { Aircraft, Airport, RouteInfo } from '../shared/types';
import { cached } from './cache';
import { USER_AGENT, type Env } from './env';

// Callsign → airline + origin/destination, from adsbdb.com. Routes are looked up by callsign,
// and callsigns get reused across different flights, so a route is only trusted if the aircraft
// is plausibly flying it right now (see isPlausible).

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

type StoredRoute = Omit<RouteInfo, 'flownKm' | 'remainingKm' | 'progress'>;

const toAirport = (a: AdsbdbAirport): Airport => ({
  iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_name, lat: a.latitude, lon: a.longitude,
});

async function fetchRoute(callsign: string): Promise<StoredRoute | null> {
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

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Looks up a callsign. Lookup failures resolve to null rather than failing the whole request.
 * With a budget, only that many lookups go to adsbdb; cached answers don't count against it.
 */
export async function lookupRoute(env: Env, callsign: string, budget?: { fetches: number }): Promise<StoredRoute | null> {
  const key = `route:v1:${callsign.toUpperCase()}`;
  try {
    // Misses are cached too, but only for 6 h, in case the database learns the callsign.
    return await cached<StoredRoute | null>(env, key, r => (r ? 24 * 3600 : 6 * 3600), () => {
      if (budget && budget.fetches-- <= 0) throw new Error('Out of lookups for this request');
      return fetchRoute(callsign);
    });
  } catch {
    return null;
  }
}

/** Adds progress figures, or returns null if the aircraft can't be on this route. */
export function withProgress(route: StoredRoute, ac: Aircraft): RouteInfo | null {
  const { origin: o, destination: d } = route;
  const total = greatCircleKm(o.lat, o.lon, d.lat, d.lon);
  const flown = greatCircleKm(o.lat, o.lon, ac.lat, ac.lon);
  const remaining = greatCircleKm(ac.lat, ac.lon, d.lat, d.lon);
  // On the great circle, flown + remaining ≈ total. Allow for airways, holds and departure turns.
  if (flown + remaining > total * 1.3 + 150) return null;
  return { ...route, flownKm: flown, remainingKm: remaining, progress: Math.min(1, Math.max(0, flown / (flown + remaining))) };
}
