// How an airport board reads a plane: where it is in its arrival or departure, and when it will
// land. Everything comes from live position, altitude, speed and climb rate; there's no timetable.

import type { Aircraft, ArrivalStatus, DepartureStatus } from './types';

/** Smallest angle between two bearings, 0..180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** `ac.distanceNm` and `ac.bearingDeg` are measured from the airport. */
export function arrivalStatus(ac: Aircraft): ArrivalStatus {
  const alt = ac.altFt, vs = ac.verticalRateFpm ?? 0, d = ac.distanceNm;
  if (alt === null) return 'landed';
  if (d < 8 && alt < 2500) return 'landing';
  if (d < 40 && alt < 12000) return 'approach';
  if (vs < -500) return 'descending';
  return 'en route';
}

export function departureStatus(ac: Aircraft): DepartureStatus {
  const alt = ac.altFt, d = ac.distanceNm;
  if (alt === null) return 'taxiing';
  if (d < 10 && alt < 4000) return 'takeoff';
  if (alt < 20000 && (ac.verticalRateFpm ?? 0) > 300) return 'climbing';
  return 'departed';
}

/**
 * Minutes to touchdown: distance over speed, plus the extra track miles of a descent and an
 * approach pattern, and a slower average once the plane is close in.
 */
export function etaMinutes(ac: Aircraft): number {
  if (ac.altFt === null) return 0;
  const d = ac.distanceNm;
  let speed = Math.min(520, Math.max(140, ac.groundSpeedKt ?? 250));
  if (d < 40) speed = Math.min(speed, 210);
  const extraNm = d > 15 ? Math.min(25, 3 + d * 0.12) : 1;
  return Math.max(1, Math.round(((d + extraNm) / speed) * 60));
}

/**
 * Roughly how many minutes until a plane reaches the end of its route, `remainingKm` away. On a
 * long way still to go, at least a jet's cruising speed (a plane climbing out is slow now but
 * won't be for long); near the end, as fast as it's going, and no faster than an approach once
 * close in. Like etaMinutes, it allows for the extra distance of a descent and approach pattern.
 * Null on the ground or when too slow to say.
 */
export function minutesToGo(remainingKm: number, ac: Pick<Aircraft, 'altFt' | 'groundSpeedKt'>): number | null {
  const kmh = (ac.groundSpeedKt ?? 0) * 1.852;
  if (ac.altFt === null || kmh <= 150) return null;
  const pace = remainingKm > 400 ? Math.max(kmh, 780) : remainingKm < 75 ? Math.min(kmh, 390) : kmh;
  const extraKm = remainingKm > 28 ? Math.min(46, 6 + remainingKm * 0.12) : 2;
  return ((remainingKm + extraKm) / pace) * 60;
}

/** Pointing at the airport, or already low and close to it (vectored, holding or on base). */
export function mayBeArriving(ac: Aircraft): boolean {
  if (ac.altFt === null) return ac.distanceNm < 3 && (ac.groundSpeedKt ?? 0) > 3;
  if (ac.distanceNm < 25 && ac.altFt < 10000) return true;
  if (ac.trackDeg === null) return false;
  return angleBetween(ac.trackDeg, (ac.bearingDeg + 180) % 360) < 60;
}

/** Moving away from the airport near it, climbing, or taxiing out. */
export function mayBeDeparting(ac: Aircraft): boolean {
  if (ac.altFt === null) return ac.distanceNm < 3 && (ac.groundSpeedKt ?? 0) > 3;
  if (ac.distanceNm > 80 || ac.trackDeg === null) return false;
  return angleBetween(ac.trackDeg, ac.bearingDeg) < 60 && ((ac.verticalRateFpm ?? 0) > 0 || ac.altFt < 25000);
}
