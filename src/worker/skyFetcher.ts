import { DurableObject } from 'cloudflare:workers';
import type { AircraftResponse } from '../shared/types';
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

const STORE_PREFIX = 'last:';
const STALE_OK_MS = 90_000;

type Result = AircraftResponse | { error: string; details: string[] };

export class SkyFetcher extends DurableObject<Env> {
  // A short pause after "too many requests": the Workers will try from other addresses meanwhile.
  private memory: SourceMemory = { restingUntil: new Map(), lastGood: new Map(), max429Rest: 20 };
  private fresh = new Map<string, AircraftResponse>();
  private inFlight = new Map<string, Promise<Result>>();

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
    this.memory.lastGood.set(key, result);
    await this.ctx.storage.put(STORE_PREFIX + key, result);
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
        await this.ctx.storage.put(STORE_PREFIX + key, result);
      }
      return result;
    } catch (err) {
      return { error: (err as Error).message, details: err instanceof AircraftUnavailable ? err.details : [] };
    }
  }
}
