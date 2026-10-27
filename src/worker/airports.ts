import { arrivalStatus, departureStatus, etaMinutes, mayBeArriving, mayBeDeparting } from '../shared/arrivals';
import { MAX_AIRPORTS, type SavedAirport } from '../shared/settings';
import type { AirportBoardResponse, AirportFlight } from '../shared/types';
import { getAircraft, type AircraftUnavailable } from './aircraft';
import { cached } from './cache';
import { json, type Env } from './env';
import { lookupRoute, withProgress } from './routes';
import { loadSettings } from './settings';

// The arrivals and departures board for the airport chosen in /setup, worked out from open data:
// live positions round the airport, and each callsign's route from adsbdb. A plane is an
// arrival when its route ends here, a departure when it starts here. There's no timetable, so
// the board only knows flights that are already in the air (or taxiing) within RADIUS_NM.

const RADIUS_NM = 100;
const AIRLINE_CALLSIGN = /^[A-Z]{3}\d[0-9A-Z]{0,4}$/;
/** Planes considered per board, nearest first. Routes already cached cost nothing. */
const MAX_CANDIDATES = 80;
/** New adsbdb lookups per board (the free plan allows 50 outside requests per request). */
const NEW_LOOKUPS = 25;
const BOARD_SECONDS = 25;
const MAX_ROWS = 12;

export async function handleAirportBoard(env: Env, url: URL): Promise<Response> {
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  const airport = (await loadSettings(env)).sky?.airports?.slice(0, MAX_AIRPORTS).find(a => a.icao === code);
  // Only the airport chosen in /setup, so the board can't be used to query anywhere at all.
  if (!airport) return json({ error: 'That airport isn’t set up. Choose it in /setup › Airport board.' }, { status: 404 });
  try {
    return json(await cached(env, `airport:v1:${airport.icao}`, BOARD_SECONDS, () => buildBoard(env, airport)));
  } catch (err) {
    return json({ error: (err as Error).message, details: (err as AircraftUnavailable).details }, { status: 502 });
  }
}

async function buildBoard(env: Env, airport: SavedAirport): Promise<AirportBoardResponse> {
  const data = await getAircraft(env, { home: { lat: airport.lat, lon: airport.lon }, radiusNm: RADIUS_NM });
  const candidates = data.aircraft
    .filter(a => !!a.callsign && AIRLINE_CALLSIGN.test(a.callsign) && (mayBeArriving(a) || mayBeDeparting(a)))
    .slice(0, MAX_CANDIDATES);

  const budget = { fetches: NEW_LOOKUPS };
  const arrivals: AirportFlight[] = [];
  const departures: AirportFlight[] = [];
  // Started nearest first, so the lookup budget mostly goes on the planes that matter soonest.
  const routes = await Promise.all(candidates.map(ac => lookupRoute(env, ac.callsign!, budget)));
  candidates.forEach((ac, i) => {
    const stored = routes[i];
    const route = stored && withProgress(stored, ac);
    if (!route) return;
    const row = (other: typeof route.origin): Omit<AirportFlight, 'status' | 'etaMin'> => ({
      hex: ac.hex,
      flight: route.flightNumber ?? ac.callsign!,
      airline: route.airline?.name ?? null,
      code: other.iata || other.icao,
      city: other.city || other.name,
      type: ac.type,
      altFt: ac.altFt,
      distanceNm: Math.round(ac.distanceNm * 10) / 10,
    });
    if (route.destination.icao === airport.icao && mayBeArriving(ac)) {
      arrivals.push({ ...row(route.origin), status: arrivalStatus(ac), etaMin: etaMinutes(ac) });
    } else if (route.origin.icao === airport.icao && mayBeDeparting(ac)) {
      departures.push({ ...row(route.destination), status: departureStatus(ac), etaMin: null });
    }
  });

  arrivals.sort((a, b) => a.etaMin! - b.etaMin!);
  departures.sort((a, b) => order(a) - order(b));
  // A busy airport has a dozen planes taxiing at once; keep a few so the air traffic still shows.
  const few = (list: AirportFlight[], onGround: number) => [...list.filter(f => f.altFt === null).slice(0, onGround), ...list.filter(f => f.altFt !== null)];
  return {
    airport: { icao: airport.icao, iata: airport.iata, name: airport.name, city: airport.city },
    fetchedAt: data.fetchedAt,
    source: data.source,
    stale: data.stale,
    radiusNm: RADIUS_NM,
    arrivals: few(arrivals, 2).slice(0, MAX_ROWS),
    departures: few(departures, 3).slice(0, MAX_ROWS),
  };
}

/** Departures: taxiing first, then the ones that left most recently. */
const order = (f: AirportFlight) => (f.altFt === null ? -1 : f.distanceNm);
