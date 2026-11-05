// A small promise wrapper over IndexedDB, the on-device storage behind the app's stand-ins for
// Cloudflare KV, R2 and Durable Object storage. WKWebView keeps IndexedDB across launches.
// (P4 may move the bulk of it to native SQLite and files; the stand-ins only see this interface.)

const DB_NAME = 'homesky-app';
const DB_VERSION = 1;
export const STORES = ['kv', 'r2meta', 'r2body', 'do'] as const;
export type StoreName = (typeof STORES)[number];

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store: StoreName, mode: IDBTransactionMode) {
  return (await open()).transaction(store, mode).objectStore(store);
}

export const idb = {
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return done((await tx(store, 'readonly')).get(key)) as Promise<T | undefined>;
  },
  async getMany<T>(store: StoreName, keys: string[]): Promise<Array<T | undefined>> {
    const s = await tx(store, 'readonly');
    return Promise.all(keys.map(k => done(s.get(k)) as Promise<T | undefined>));
  },
  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    await done((await tx(store, 'readwrite')).put(value, key));
  },
  async delete(store: StoreName, keys: string | string[]): Promise<void> {
    const s = await tx(store, 'readwrite');
    await Promise.all((Array.isArray(keys) ? keys : [keys]).map(k => done(s.delete(k))));
  },
  /** Keys starting with `prefix`, in order; after `after` when given. */
  async keys(store: StoreName, prefix: string, after?: string): Promise<string[]> {
    const lower = after ?? prefix;
    const range = IDBKeyRange.bound(lower, prefix + '￿', after !== undefined, false);
    return (await done((await tx(store, 'readonly')).getAllKeys(range))) as string[];
  },
  /** Entries whose key starts with `prefix`. */
  async entries<T>(store: StoreName, prefix: string): Promise<Array<[string, T]>> {
    const s = await tx(store, 'readonly');
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const [keys, values] = await Promise.all([done(s.getAllKeys(range)), done(s.getAll(range))]);
    return (keys as string[]).map((k, i) => [k, values[i] as T]);
  },
};

export type Idb = typeof idb;
