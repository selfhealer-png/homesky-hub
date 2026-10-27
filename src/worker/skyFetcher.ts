import { DurableObject } from 'cloudflare:workers';
import type { AircraftResponse, TrailPoint } from '../shared/types';
import { AircraftUnavailable, aircraftKey, CACHE_SECONDS, fetchFromSources, type SourceMemory } from './aircraft';
import type { Env } from './env';

// One shared fetcher for live aircraft. Every request for positions, from every screen on every
// device, comes through this single Durable Object, so the hub asks the free sources at most
// once every CACHE_SECONDS for each place, instead of once per Cloudflare server that happens
// to handle a request. That matters because those sources limit how often any one address may
// ask. It also means all screens share the same "last good" positions when a source refuses.
//
// The last good positions are also written to the object's own storage, so they survive the
// object being unloaded between requests.
//
// It also remembers where each plane has been over the last few minutes (in memory only), so a
// radar that has just opened can draw trails straight away instead of growing them from nothing.
//
// A second instance, named "lookups", holds the slow-changing lookups (routes, the aircraft
// registry, type articles) for cache.ts, because they're written for every new plane and KV's
// free plan allows only 1,000 writes a day. Expired entries are swept once a day by an alarm.

const STORE_PREFIX = 'last:';
const LOOKUP_PREFIX = 'lookup:';
const SWEEP_MS = 24 * 3600_000;
const STALE_OK_MS = 90_000;
/** How much of each plane's path is remembered, and how far apart its points are. */
const TRAIL_SECONDS = 10 * 60;
const TRAIL_STEP_SECONDS = 15;

type Result = AircraftResponse | { error: string; details: string[] };
type Lookup = { v: unknown; exp: number };

export class SkyFetcher extends DurableObject<Env> {
  // A short pause after "too many requests": the Workers will try from other addresses meanwhile.
  private memory: SourceMemory = { restingUntil: new Map(), lastGood: new Map(), max429Rest: 20 };
  private fresh = new Map<string, AircraftResponse>();
  private inFlight = new Map<string, Promise<Result>>();
  /** Per place, per hex: recent positions, oldest first. */
  private paths = new Map<string, Map<string, TrailPoint[]>>();
  private sweepSet = false;

  /** Stored lookups for these keys; missing or expired ones are left out. */
  async recall(keys: string[]): Promise<Record<string, Lookup>> {
    const found = await this.ctx.storage.get<Lookup>(keys.map(k => LOOKUP_PREFIX + k));
    const out: Record<string, Lookup> = {};
    const now = Date.now();
    for (const [k, entry] of found) if (entry.exp > now) out[k.slice(LOOKUP_PREFIX.length)] = entry;
    return out;
  }

  async keep(key: string, entry: Lookup): Promise<void> {
    await this.ctx.storage.put(LOOKUP_PREFIX + key, entry);
    if (!this.sweepSet) {
      this.sweepSet = true;
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const all = await this.ctx.storage.list<Lookup>({ prefix: LOOKUP_PREFIX });
    const expired = [...all].filter(([, e]) => e.exp <= now).map(([k]) => k);
    for (let i = 0; i < expired.length; i += 128) await this.ctx.storage.delete(expired.slice(i, i + 128));
    if (all.size > expired.length) await this.ctx.storage.setAlarm(now + SWEEP_MS);
    else this.sweepSet = false;
  }

  async aircraft(lat: number, lon: number, nm: number): Promise<Result> {
    const key = aircraftKey(lat, lon, nm);
    const hit = this.fresh.get(key);
    if (hit && Date.now() - hit.fetchedAt < CACHE_SECONDS * 1000) return hit;

    // Several screens asking at once share one fetch.
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const work = this.refresh(key, lat, lon, nm).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** A Worker fetched fresh positions itself (from a different address); keep them for everyone. */
  async offer(lat: number, lon: number, nm: number, result: AircraftResponse): Promise<void> {
    const key = aircraftKey(lat, lon, nm);
    const current = this.fresh.get(key);
    if (current && current.fetchedAt >= result.fetchedAt) return;
    this.fresh.set(key, result);
    this.record(key, result);
    this.memory.lastGood.set(key, result);
    await this.ctx.storage.put(STORE_PREFIX + key, result);
  }

  /** Where each plane round this place has been lately. */
  async trails(lat: number, lon: number, nm: number): Promise<Record<string, TrailPoint[]>> {
    return Object.fromEntries(this.paths.get(aircraftKey(lat, lon, nm)) ?? []);
  }

  private record(key: string, result: AircraftResponse) {
    const now = Math.round(result.fetchedAt / 1000);
    const paths = this.paths.get(key) ?? new Map<string, TrailPoint[]>();
    this.paths.set(key, paths);
    const seen = new Set<string>();
    for (const a of result.aircraft) {
      if (a.altFt === null) continue;
      seen.add(a.hex);
      const path = paths.get(a.hex) ?? [];
      const last = path[path.length - 1];
      if (!last || now - last[2] >= TRAIL_STEP_SECONDS) path.push([Math.round(a.lat * 1e4) / 1e4, Math.round(a.lon * 1e4) / 1e4, now]);
      while (path.length && now - path[0][2] > TRAIL_SECONDS) path.shift();
      paths.set(a.hex, path);
    }
    // Planes that have left (or landed) are forgotten once their last point is a couple of minutes old.
    for (const [hex, path] of paths) if (!seen.has(hex) && now - path[path.length - 1][2] > 120) paths.delete(hex);
  }

  private async refresh(key: string, lat: number, lon: number, nm: number): Promise<Result> {
    if (!this.memory.lastGood.has(key)) {
      const stored = await this.ctx.storage.get<AircraftResponse>(STORE_PREFIX + key);
      if (stored && Date.now() - stored.fetchedAt < STALE_OK_MS) this.memory.lastGood.set(key, stored);
    }
    try {
      const result = await fetchFromSources(this.env, lat, lon, nm, this.memory);
      if (!result.stale) {
        this.fresh.set(key, result);
        this.record(key, result);
        await this.ctx.storage.put(STORE_PREFIX + key, result);
      }
      return result;
    } catch (err) {
      return { error: (err as Error).message, details: err instanceof AircraftUnavailable ? err.details : [] };
    }
  }
}
