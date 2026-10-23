import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, propagate, twoline2satrec } from 'satellite.js';
import { moonPhase, moonTimes, phaseName, sunAltitude, sunLongitude, tonight } from '../shared/astro';
import type { IssPass, TonightResponse } from '../shared/types';
import { cached } from './cache';
import { json, USER_AGENT, type Env } from './env';
import { skyContext } from './sky';

// Tonight's sky: the night's times, the moon, the chance of aurora, the cloud, and when the
// International Space Station passes over, visibly. All free and keyless:
//   ISS orbit   CelesTrak (fetched at most every 6 hours, as CelesTrak asks)
//   aurora      NOAA Space Weather Prediction Center's 3-day Kp forecast
//   cloud       Open-Meteo

const HOUR = 3_600_000;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (az: number) => COMPASS[Math.round((((az * 180) / Math.PI + 360) % 360) / 45) % 8];

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

// ── ISS ──────────────────────────────────────────────────────────────────────

const EARTH_KM = 6371;
const MIN_ELEVATION = 10; // degrees: lower passes are lost in trees and haze

/** Whether the station is in sunlight (so it shines), using Earth's shadow as a cylinder. */
function sunlit(pos: { x: number; y: number; z: number }, t: number): boolean {
  const L = sunLongitude(t / 86_400_000 - 10957.5);
  const ε = degreesToRadians(23.4397);
  const s = { x: Math.cos(L), y: Math.cos(ε) * Math.sin(L), z: Math.sin(ε) * Math.sin(L) };
  const along = pos.x * s.x + pos.y * s.y + pos.z * s.z;
  if (along > 0) return true;
  const across = Math.hypot(pos.x - along * s.x, pos.y - along * s.y, pos.z - along * s.z);
  return across > EARTH_KM;
}

/** Visible passes over the next three days: the station sunlit, the observer's sky dark. */
function issPasses(tle: string, lat: number, lon: number, now: number): IssPass[] {
  const lines = tle.trim().split(/\r?\n/).map(l => l.trim());
  const l1 = lines.find(l => l.startsWith('1 ')), l2 = lines.find(l => l.startsWith('2 '));
  if (!l1 || !l2) return [];
  const sat = twoline2satrec(l1, l2);
  const observer = { latitude: degreesToRadians(lat), longitude: degreesToRadians(lon), height: 0.1 };

  const passes: IssPass[] = [];
  let pass: { start: number; from: string; maxAt: number; maxElev: number; seen: boolean; to: string; end: number } | undefined;
  for (let t = now; t < now + 72 * HOUR; t += 20_000) {
    const date = new Date(t);
    const pv = propagate(sat, date);
    const pos = pv?.position;
    if (!pos || typeof pos === 'boolean') continue;
    const look = ecfToLookAngles(observer, eciToEcf(pos, gstime(date)));
    const elev = (look.elevation * 180) / Math.PI;
    if (elev >= MIN_ELEVATION) {
      const seen = sunAltitude(t, lat, lon) < -6 && sunlit(pos, t);
      if (!pass) pass = { start: t, from: compass(look.azimuth), maxAt: t, maxElev: elev, seen, to: '', end: t };
      if (elev > pass.maxElev) Object.assign(pass, { maxAt: t, maxElev: elev });
      pass.seen ||= seen;
      Object.assign(pass, { end: t, to: compass(look.azimuth) });
    } else if (pass) {
      if (pass.seen) passes.push({ start: new Date(pass.start).toISOString(), end: new Date(pass.end).toISOString(), maxElev: Math.round(pass.maxElev), from: pass.from, to: pass.to });
      pass = undefined;
      if (passes.length >= 4) break;
      t += 60 * 60_000; // the next pass is at least an orbit away
    }
  }
  return passes;
}

// ── Aurora ───────────────────────────────────────────────────────────────────

/** Geomagnetic latitude (a tilted dipole): what decides how far south the aurora reaches. */
function magneticLatitude(lat: number, lon: number): number {
  const [pLat, pLon] = [degreesToRadians(80.7), degreesToRadians(-72.7)];
  const [φ, λ] = [degreesToRadians(lat), degreesToRadians(lon)];
  return (Math.asin(Math.sin(φ) * Math.sin(pLat) + Math.cos(φ) * Math.cos(pLat) * Math.cos(λ - pLon)) * 180) / Math.PI;
}

/** The aurora's southern edge sits near magnetic latitude 66.5° − 2·Kp; it can be seen a few degrees beyond. */
export function auroraChance(kp: number, lat: number, lon: number): TonightResponse['aurora'] {
  const reach = Math.abs(magneticLatitude(lat, lon)) - (66.5 - 2 * kp);
  const chance = reach >= 0 ? 'good' : reach >= -2.5 ? 'possible' : 'unlikely';
  return { kp: Math.round(kp * 10) / 10, chance };
}

async function kpTonight(env: Env, from: number, to: number): Promise<number | undefined> {
  const rows = await cached(env, 'tonight:kp', 1800, async () =>
    (JSON.parse(await getText('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json')) as Array<{ time_tag: string; kp: number }>)
      .map(r => ({ t: Date.parse(`${r.time_tag}Z`), kp: r.kp })));
  // Each row covers three hours from its time.
  const kps = rows.filter(r => r.t + 3 * HOUR > from && r.t < to).map(r => r.kp);
  return kps.length ? Math.max(...kps) : undefined;
}

// ── Cloud ────────────────────────────────────────────────────────────────────

async function cloudTonight(env: Env, lat: number, lon: number, from: number, to: number): Promise<number | undefined> {
  const hourly = await cached(env, `tonight:cloud:${lat}:${lon}`, 1800, async () => {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover&forecast_days=3&timezone=UTC`;
    const d = JSON.parse(await getText(u)) as { hourly: { time: string[]; cloud_cover: number[] } };
    return d.hourly.time.map((t, i) => ({ t: Date.parse(`${t}:00Z`), c: d.hourly.cloud_cover[i] }));
  });
  // The first half of the night is when people look.
  const cs = hourly.filter(h => h.t >= from && h.t <= Math.min(to, from + 6 * HOUR)).map(h => h.c);
  return cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : undefined;
}

// ── Together ─────────────────────────────────────────────────────────────────

export async function handleTonight(env: Env, url: URL, request: Request): Promise<Response> {
  const { home } = await skyContext(env, url, request);
  const now = Date.now();
  const night = tonight(now, home.lat, home.lon);
  const iso = (t?: number) => (t === undefined ? undefined : new Date(t).toISOString());
  const from = night.dark ?? night.sunset ?? now;
  const to = night.darkEnds ?? night.sunrise ?? from + 8 * HOUR;
  const { phase, fraction } = moonPhase(now);
  const moon = moonTimes(now - 2 * HOUR, home.lat, home.lon);

  // Each part is optional: one service being down shouldn't blank the screen.
  const [tle, kp, cloud] = await Promise.all([
    cached(env, 'tonight:iss-tle', 6 * 3600, () => getText('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE')).catch(() => undefined),
    kpTonight(env, from, to).catch(() => undefined),
    cloudTonight(env, home.lat, home.lon, from, to).catch(() => undefined),
  ]);
  const iss = tle ? await cached(env, `tonight:iss:${home.lat}:${home.lon}`, 3600, async () => issPasses(tle, home.lat, home.lon, now)) : undefined;

  const body: TonightResponse = {
    night: { sunset: iso(night.sunset), dark: iso(night.dark), darkEnds: iso(night.darkEnds), sunrise: iso(night.sunrise), allDay: night.allDay, allNight: night.allNight },
    moon: { name: phaseName(phase), phase, fraction, rise: iso(moon.rise), set: iso(moon.set) },
    aurora: kp === undefined ? undefined : auroraChance(kp, home.lat, home.lon),
    cloud,
    // Passes already over are dropped, even from a cached list.
    iss: iss?.filter(p => Date.parse(p.end) > now),
  };
  return json(body);
}
