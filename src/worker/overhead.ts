import { classify } from '../shared/notable';
import type { Aircraft, OverheadResponse } from '../shared/types';
import { getAircraft, type AircraftUnavailable } from './aircraft';
import { json, type Env } from './env';
import { lookupRoute, withProgress } from './routes';
import { loadSettings } from './settings';
import { skyContext } from './sky';
import { followMatcher } from './track';

// Picks the one aircraft the overhead board should show.
// Priority: an emergency squawk in range, then a rare aircraft, then the flight the Flight tracker follows if it's
// passing, then the aircraft the display is holding (so the board doesn't flip between two
// planes at similar distances), then the nearest one.

const AIRLINE_CALLSIGN = /^[A-Z]{3}\d[0-9A-Z]{0,4}$/; // ICAO airline prefix + flight number
const ROUTE_LOOKUPS = 4; // at most this many adsbdb lookups per request; they're cached for 24 h

export async function handleOverhead(url: URL, env: Env, request: Request): Promise<Response> {
  const sky = await skyContext(env, url, request).catch(err => err as Error);
  if (sky instanceof Error) return json({ error: sky.message }, { status: 500 });
  const radiusNm = Math.min(sky.radiusNm, Number(env.BOARD_RADIUS_NM ?? 20));
  const minAltFt = Number(env.BOARD_MIN_ALT_FT ?? 300);
  const airlinersOnly = (env.BOARD_AIRLINERS_ONLY ?? '1') === '1';
  const hold = url.searchParams.get('hold');

  let data;
  try {
    data = await getAircraft(env, sky);
  } catch (err) {
    return json({ error: (err as Error).message, details: (err as AircraftUnavailable).details }, { status: 502 });
  }

  const candidates = data.aircraft.filter(a =>
    a.distanceNm <= radiusNm &&
    a.altFt !== null && a.altFt >= minAltFt &&
    (!airlinersOnly || (!!a.callsign && AIRLINE_CALLSIGN.test(a.callsign))));

  const ordered: Array<[Aircraft, OverheadResponse['reason']]> = [];
  const add = (a: Aircraft | undefined, reason: OverheadResponse['reason']) => {
    if (a && !ordered.some(([o]) => o.hex === a.hex)) ordered.push([a, reason]);
  };
  // Emergencies are shown even when they don't pass the airliner filter.
  add(data.aircraft.find(a => a.emergency && a.distanceNm <= radiusNm), 'emergency');
  // So are rare aircraft (a Beluga, a Spitfire): the reason to look up.
  add(data.aircraft.find(a => a.distanceNm <= radiusNm && a.altFt !== null && classify(a)?.kind === 'rare'), 'notable');
  const follow = (await loadSettings(env)).sky?.follow;
  if (follow) {
    const isFollowed = await followMatcher(env, follow);
    add(data.aircraft.find(a => a.distanceNm <= radiusNm && a.altFt !== null && isFollowed(a)), 'followed');
  }
  add(candidates.find(a => a.hex === hold), 'held');
  candidates.forEach(a => add(a, 'nearest'));

  // Prefer an aircraft whose route checks out, but never skip past the held/emergency one.
  let lookups = 0;
  for (const [aircraft, reason] of ordered) {
    if (lookups >= ROUTE_LOOKUPS) break;
    const stored = aircraft.callsign ? (lookups++, await lookupRoute(env, aircraft.callsign)) : null;
    const route = stored ? withProgress(stored, aircraft) : null;
    if (route || reason !== 'nearest') return json(result(data, candidates.length, aircraft, route, reason));
  }

  // Nothing had a usable route: show the nearest anyway, as type and registration.
  const [first] = ordered;
  return json(result(data, candidates.length, first?.[0] ?? null, null, first?.[1] ?? null));
}

function result(data: { fetchedAt: number; source: string }, candidates: number, aircraft: Aircraft | null,
  route: OverheadResponse['route'], reason: OverheadResponse['reason']): OverheadResponse {
  return { fetchedAt: data.fetchedAt, source: data.source, candidates, aircraft, route, reason };
}
