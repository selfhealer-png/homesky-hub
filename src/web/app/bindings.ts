import type { Idb } from './idb';

// On-device stand-ins for the three Cloudflare bindings the Worker uses (see src/worker/env.ts):
// HUB_KV, PHOTOS (R2) and SKY (a Durable Object namespace). Each one implements only the calls
// the Worker actually makes, over a key-value store (IndexedDB in the page, a Map in tests).
// They are cast to the Cloudflare types when the env is built.

type Get = 'text' | 'json' | 'arrayBuffer';
interface KvEntry { v: string | ArrayBuffer; exp: number | null }

/** KV: get/put/delete/list, with expirationTtl honoured on read. */
export class LocalKV {
  constructor(private db: Idb) {}

  async get(key: string, opt?: Get | { type?: Get }): Promise<unknown> {
    const type = typeof opt === 'string' ? opt : opt?.type ?? 'text';
    const e = await this.db.get<KvEntry>('kv', key);
    if (!e) return null;
    if (e.exp !== null && e.exp <= Date.now()) {
      await this.db.delete('kv', key);
      return null;
    }
    const text = typeof e.v === 'string' ? e.v : new TextDecoder().decode(e.v);
    if (type === 'json') return JSON.parse(text);
    if (type === 'arrayBuffer') return typeof e.v === 'string' ? new TextEncoder().encode(e.v).buffer : e.v;
    return text;
  }

  async put(key: string, value: string | ArrayBuffer, opts: { expirationTtl?: number; expiration?: number } = {}): Promise<void> {
    const exp = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : opts.expiration ? opts.expiration * 1000 : null;
    await this.db.put('kv', key, { v: value, exp } satisfies KvEntry);
  }

  async delete(key: string): Promise<void> {
    await this.db.delete('kv', key);
  }

  async list(opts: { prefix?: string } = {}) {
    const keys = await this.db.keys('kv', opts.prefix ?? '');
    return { keys: keys.map(name => ({ name })), list_complete: true, cacheStatus: null };
  }
}

interface R2Meta { size: number; etag: string; uploaded: number; httpMetadata: { contentType?: string }; customMetadata: Record<string, string> }

const LIST_LIMIT = 1000;

/** R2: put/get (with If-None-Match)/list/delete, metadata kept apart so listing never loads bodies. */
export class LocalBucket {
  constructor(private db: Idb) {}

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string, opts: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } = {}) {
    const body = typeof value === 'string' ? new TextEncoder().encode(value).buffer
      : ArrayBuffer.isView(value) ? (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer) : value;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', body));
    const etag = [...digest.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
    const meta: R2Meta = { size: body.byteLength, etag, uploaded: Date.now(), httpMetadata: opts.httpMetadata ?? {}, customMetadata: opts.customMetadata ?? {} };
    await this.db.put('r2body', key, body);
    await this.db.put('r2meta', key, meta);
    return object(key, meta);
  }

  async head(key: string) {
    const meta = await this.db.get<R2Meta>('r2meta', key);
    return meta ? object(key, meta) : null;
  }

  async get(key: string, opts: { onlyIf?: Headers } = {}) {
    const meta = await this.db.get<R2Meta>('r2meta', key);
    if (!meta) return null;
    const inm = opts.onlyIf instanceof Headers ? opts.onlyIf.get('if-none-match') : null;
    if (inm && inm.replace(/^W\//, '') === `"${meta.etag}"`) return object(key, meta); // no body: the caller answers 304
    const body = await this.db.get<ArrayBuffer>('r2body', key);
    if (!body) return null;
    return {
      ...object(key, meta),
      get body() { return new Blob([body]).stream(); },
      arrayBuffer: async () => body,
      text: async () => new TextDecoder().decode(body),
      json: async () => JSON.parse(new TextDecoder().decode(body)),
    };
  }

  async list(opts: { prefix?: string; cursor?: string; limit?: number; include?: string[] } = {}) {
    const limit = Math.min(opts.limit ?? LIST_LIMIT, LIST_LIMIT);
    const all = await this.db.keys('r2meta', opts.prefix ?? '', opts.cursor);
    const page = all.slice(0, limit);
    const metas = await this.db.getMany<R2Meta>('r2meta', page);
    const truncated = all.length > limit;
    return {
      objects: page.map((k, i) => object(k, metas[i]!)),
      truncated,
      cursor: truncated ? page[page.length - 1] : undefined,
      delimitedPrefixes: [],
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    await this.db.delete('r2body', keys);
    await this.db.delete('r2meta', keys);
  }
}

function object(key: string, m: R2Meta) {
  return {
    key,
    size: m.size,
    etag: m.etag,
    httpEtag: `"${m.etag}"`,
    uploaded: new Date(m.uploaded),
    httpMetadata: m.httpMetadata,
    customMetadata: m.customMetadata,
    writeHttpMetadata(headers: Headers) {
      if (m.httpMetadata.contentType) headers.set('content-type', m.httpMetadata.contentType);
    },
  };
}

/** Durable Object storage for one named object, over the 'do' store with the name as prefix. */
export class LocalStorage {
  private alarmAt: number | null = null;
  private alarmTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private db: Idb, private prefix: string, private onAlarm: () => Promise<void>) {}

  async get<T>(keys: string | string[]): Promise<unknown> {
    if (typeof keys === 'string') return this.db.get<T>('do', this.prefix + keys);
    const values = await this.db.getMany<T>('do', keys.map(k => this.prefix + k));
    const out = new Map<string, T>();
    keys.forEach((k, i) => { if (values[i] !== undefined) out.set(k, values[i] as T); });
    return out;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.db.put('do', this.prefix + key, value);
  }

  async delete(keys: string | string[]): Promise<void> {
    await this.db.delete('do', (Array.isArray(keys) ? keys : [keys]).map(k => this.prefix + k));
  }

  async list<T>(opts: { prefix?: string } = {}): Promise<Map<string, T>> {
    const entries = await this.db.entries<T>('do', this.prefix + (opts.prefix ?? ''));
    return new Map(entries.map(([k, v]) => [k.slice(this.prefix.length), v]));
  }

  async getAlarm(): Promise<number | null> { return this.alarmAt; }

  async setAlarm(at: number | Date): Promise<void> {
    clearTimeout(this.alarmTimer);
    this.alarmAt = +at;
    // Alarms only need to fire while the app is open; the next keep() sets a new one otherwise.
    this.alarmTimer = setTimeout(() => {
      this.alarmAt = null;
      this.onAlarm().catch(() => {});
    }, Math.min(Math.max(0, this.alarmAt - Date.now()), 2 ** 31 - 1));
  }
}

/**
 * A Durable Object namespace with every object living in this page. Calls are made directly,
 * but arguments and results are copied, as Cloudflare's RPC does, so callers can't change an
 * object's state by mutating what they got back.
 */
export class LocalNamespace<T extends object> {
  private objects = new Map<string, T>();

  constructor(private db: Idb, private make: (state: { storage: LocalStorage }, name: string) => T) {}

  idFromName(name: string) { return name; }

  get(id: string): T {
    let obj = this.objects.get(id);
    if (!obj) {
      let self: T;
      const storage = new LocalStorage(this.db, `${id}\u0000`, async () => {
        const alarm = (self as { alarm?: () => Promise<void> }).alarm;
        if (alarm) await alarm.call(self);
      });
      obj = self = this.make({ storage }, id);
      this.objects.set(id, obj);
    }
    const target = obj;
    return new Proxy(target, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (typeof v !== 'function') return v;
        return async (...args: unknown[]) => structuredClone(await v.apply(t, args.map(a => structuredClone(a))));
      },
    });
  }
}
