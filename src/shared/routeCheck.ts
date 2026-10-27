import { angleBetween } from './arrivals';
import type { Aircraft } from './types';

// Whether a plane can really be flying the route its callsign looks up to. Airlines reuse
// callsigns for different flights, and the route database only knows one of them, so a plane
// landing at Heathrow can come back as "Faro → Cologne". Checked from where the plane is, how
// high, and which way it's going; there's nothing to ask.

type Point = { lat: number; lon: number };

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial great-circle bearing from one point to another, 0..360. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const k = Math.PI / 180;
  const dLon = (lon2 - lon1) * k;
  const y = Math.sin(dLon) * Math.cos(lat2 * k);
  const x = Math.cos(lat1 * k) * Math.sin(lat2 * k) - Math.sin(lat1 * k) * Math.cos(lat2 * k) * Math.cos(dLon);
  return (Math.atan2(y, x) / k + 360) % 360;
}

/** Below this, a plane is taking off or landing, so it should be near one end of its route. */
const LOW_FT = 5000;
const LOW_NEAR_KM = 60;
/** On the ground, it should be at one end. */
const GROUND_NEAR_KM = 15;
/** Further than this from both ends, a plane is en route and should be heading for its destination… */
const EN_ROUTE_KM = 150;
/** …give or take airways and weather. A long way out, much more: long-haul flights go round
 *  closed airspace (Paris to Tokyo heads south-east, not over Russia), jet streams and the pole. */
const MAX_OFF_COURSE_DEG = 70;
const LONG_HAUL_KM = 2500;
const MAX_OFF_COURSE_LONG_HAUL_DEG = 110;

export type RouteMisfit = 'off the line' | 'low away from both ends' | 'on the ground elsewhere' | 'heading away';

/** Why the plane can't be flying this route, or null if it can. */
export function routeMisfit(ac: Pick<Aircraft, 'lat' | 'lon' | 'altFt' | 'trackDeg' | 'onGround'>, origin: Point, destination: Point): RouteMisfit | null {
  const total = greatCircleKm(origin.lat, origin.lon, destination.lat, destination.lon);
  const flown = greatCircleKm(origin.lat, origin.lon, ac.lat, ac.lon);
  const remaining = greatCircleKm(ac.lat, ac.lon, destination.lat, destination.lon);
  // On the great circle, flown + remaining ≈ total. Allow for airways, holds and departure turns.
  if (flown + remaining > total * 1.3 + 150) return 'off the line';
  const nearEnd = Math.min(flown, remaining);
  if (ac.onGround) return nearEnd > GROUND_NEAR_KM ? 'on the ground elsewhere' : null;
  // (No altitude without being on the ground: the feed didn't say, so only the heading is checked.)
  if (ac.altFt !== null && ac.altFt < LOW_FT && nearEnd > LOW_NEAR_KM) return 'low away from both ends';
  if (nearEnd > EN_ROUTE_KM && ac.trackDeg !== null) {
    const toward = bearingDeg(ac.lat, ac.lon, destination.lat, destination.lon);
    const limit = remaining > LONG_HAUL_KM ? MAX_OFF_COURSE_LONG_HAUL_DEG : MAX_OFF_COURSE_DEG;
    if (angleBetween(ac.trackDeg, toward) > limit) return 'heading away';
  }
  return null;
}
