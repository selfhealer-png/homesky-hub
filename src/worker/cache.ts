import type { Env } from './env';

// Two-level cache. Level one is memory, which lives as long as the Worker isolate. Level two is
// shared between isolates: KV by default (when HUB_KV is bound), or the SKY Durable Object's
// storage for lookups that are written often, such as routes and registry entries for every
// new plane overhead. The free plan allows only 1,000 KV writes a day, but 100,000 rows written
// to Durable Object storage. The Cache API is deliberately not used: it does nothing on
// *.workers.dev hosts, which is where most deployments of this project will live.

const memory = new Map<string, { value: unknown; expires: number }>();
const MEMORY_LIMIT = 2000;
const SHARED_MIN_TTL = 60;

export type Level2 = 'kv' | 'sky';
type Entry<T> = { v: T; exp: number };

export async function cached<T>(env: Env, key: string, ttlSec: number | ((value: T) => number), load: () => Promise<T>, level2: Level2 = 'kv'): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  // Very short-lived values (live positions) stay in memory only, so there's nothing to read.
  const shared = typeof ttlSec === 'number' && ttlSec < SHARED_MIN_TTL ? null : store(env, level2);
  if (shared) {
    const stored = (await shared.get(key).catch(() => null)) as Entry<T> | null;
    if (stored && stored.exp > Date.now()) {
      remember(key, stored.v, (stored.exp - Date.now()) / 1000);
      return stored.v;
    }
  }

  const value = await load();
  const ttl = typeof ttlSec === 'function' ? ttlSec(value) : ttlSec;
  remember(key, value, ttl);
  const keep = ttl >= SHARED_MIN_TTL ? store(env, level2) : null;
  if (keep) await keep.put(key, { v: value, exp: Date.now() + ttl * 1000 }, ttl).catch(() => {});
  return value;
}

function remember(key: string, value: unknown, ttlSec: number) {
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
  memory.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}

interface Store {
  get(key: string): Promise<unknown>;
  put(key: string, entry: Entry<unknown>, ttlSec: number): Promise<void>;
}

function store(env: Env, level2: Level2): Store | null {
  if (level2 === 'sky' && env.SKY) return skyStore(env);
  const kv = env.HUB_KV;
  if (!kv) return null;
  return {
    get: key => kv.get(key, 'json'),
    put: (key, entry, ttl) => kv.put(key, JSON.stringify(entry), { expirationTtl: ttl }),
  };
}

// Lookups for several planes usually arrive together (Promise.all over the radar's nearest
// aircraft), so gets made in the same tick share one call to the Durable Object.
let batch: { keys: Set<string>; result: Promise<Record<string, unknown>> } | null = null;

function skyStore(env: Env): Store {
  const lookups = () => env.SKY!.get(env.SKY!.idFromName('lookups'));
  return {
    async get(key) {
      if (!batch) {
        const keys = new Set<string>();
        const result = Promise.resolve().then(() => {
          batch = null;
          return lookups().recall([...keys]) as Promise<Record<string, unknown>>;
        });
        batch = { keys, result };
      }
      batch.keys.add(key);
      return (await batch.result)[key] ?? null;
    },
    put: (key, entry) => lookups().keep(key, entry),
  };
}
