import type { Idb, StoreName } from './idb';

// The KV store (settings, encrypted connection secrets, captions) over Capacitor Preferences,
// i.e. UserDefaults: unlike a web view's IndexedDB, iOS never clears it to free space. Only the
// small, precious data goes here; caches and photo bytes stay in IndexedDB, where losing them
// costs nothing but a refetch. Same interface as idb.ts, so LocalKV doesn't know the difference.

type Prefs = typeof import('@capacitor/preferences').Preferences;

const PREFIX = 'kv:';
const BIN = '\u0000b64:';

const encode = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x instanceof ArrayBuffer ? BIN + btoa(String.fromCharCode(...new Uint8Array(x))) : x);
const decode = (s: string): unknown => JSON.parse(s, (_k, x) =>
  typeof x === 'string' && x.startsWith(BIN) ? Uint8Array.from(atob(x.slice(BIN.length)), c => c.charCodeAt(0)).buffer : x);

export function prefsStore(prefs: Prefs): Idb {
  const get = async <T>(_s: StoreName, key: string) => {
    const { value } = await prefs.get({ key: PREFIX + key });
    return value === null ? undefined : (decode(value) as T);
  };
  const keys = async (_s: StoreName, prefix: string, after?: string) => (await prefs.keys()).keys
    .filter(k => k.startsWith(PREFIX + prefix))
    .map(k => k.slice(PREFIX.length))
    .filter(k => after === undefined || k > after)
    .sort();
  return {
    get,
    getMany: async <T>(s: StoreName, ks: string[]) => Promise.all(ks.map(k => get<T>(s, k))),
    put: async (_s, key, value) => { await prefs.set({ key: PREFIX + key, value: encode(value) }); },
    delete: async (_s, ks) => { for (const k of Array.isArray(ks) ? ks : [ks]) await prefs.remove({ key: PREFIX + k }); },
    keys,
    entries: async <T>(s: StoreName, prefix: string) => {
      const ks = await keys(s, prefix);
      return Promise.all(ks.map(async k => [k, (await get<T>(s, k))!] as [string, T]));
    },
  };
}
