import type { Env } from './env';

// Two-level cache. Level one is memory, which lives as long as the Worker isolate. Level two is
// KV, used only when HUB_KV is bound. The Cache API is deliberately not used: it does nothing on
// *.workers.dev hosts, which is where most deployments of this project will live.

const memory = new Map<string, { value: unknown; expires: number }>();
const MEMORY_LIMIT = 2000;
const KV_MIN_TTL = 60;

export async function cached<T>(env: Env, key: string, ttlSec: number | ((value: T) => number), load: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const kv = env.HUB_KV;
  if (kv) {
    const stored = (await kv.get(key, 'json').catch(() => null)) as { v: T; exp: number } | null;
    if (stored) {
      remember(key, stored.v, (stored.exp - Date.now()) / 1000);
      return stored.v;
    }
  }

  const value = await load();
  const ttl = typeof ttlSec === 'function' ? ttlSec(value) : ttlSec;
  remember(key, value, ttl);
  // Very short-lived values (live positions) stay in memory only.
  if (kv && ttl >= KV_MIN_TTL) {
    await kv.put(key, JSON.stringify({ v: value, exp: Date.now() + ttl * 1000 }), { expirationTtl: ttl }).catch(() => {});
  }
  return value;
}

function remember(key: string, value: unknown, ttlSec: number) {
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
  memory.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}
