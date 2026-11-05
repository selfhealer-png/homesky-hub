import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalBucket, LocalKV, LocalNamespace } from '../src/web/app/bindings';
import type { Idb, StoreName } from '../src/web/app/idb';

/** The idb interface over Maps, sorted like IndexedDB keys. */
function memoryIdb(): Idb {
  const stores = new Map<StoreName, Map<string, unknown>>();
  const s = (n: StoreName) => stores.get(n) ?? stores.set(n, new Map()).get(n)!;
  const sorted = (n: StoreName, prefix: string) => [...s(n).keys()].filter(k => k.startsWith(prefix)).sort();
  return {
    get: async <T>(n: StoreName, k: string) => structuredClone(s(n).get(k)) as T | undefined,
    getMany: async <T>(n: StoreName, ks: string[]) => ks.map(k => structuredClone(s(n).get(k)) as T | undefined),
    put: async (n: StoreName, k: string, v: unknown) => { s(n).set(k, structuredClone(v)); },
    delete: async (n: StoreName, ks: string | string[]) => { for (const k of Array.isArray(ks) ? ks : [ks]) s(n).delete(k); },
    keys: async (n: StoreName, prefix: string, after?: string) => sorted(n, prefix).filter(k => after === undefined || k > after),
    entries: async <T>(n: StoreName, prefix: string) => sorted(n, prefix).map(k => [k, structuredClone(s(n).get(k))] as [string, T]),
  };
}

test('KV reads text and JSON, and forgets expired keys', async () => {
  const kv = new LocalKV(memoryIdb());
  await kv.put('a', JSON.stringify({ x: 1 }));
  assert.deepEqual(await kv.get('a', 'json'), { x: 1 });
  assert.equal(await kv.get('a'), '{"x":1}');
  assert.deepEqual(await kv.get('a', { type: 'json' }), { x: 1 });
  assert.equal(await kv.get('missing'), null);

  await kv.put('short', 'v', { expirationTtl: 60 });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 61_000;
    assert.equal(await kv.get('short'), null);
  } finally {
    Date.now = realNow;
  }
  await kv.delete('a');
  assert.equal(await kv.get('a'), null);
});

test('R2 stores bodies and metadata, answers If-None-Match without a body, and pages listings', async () => {
  const r2 = new LocalBucket(memoryIdb());
  const put = await r2.put('photos/aaa', new TextEncoder().encode('jpeg bytes'), { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { width: '800' } });
  const got = await r2.get('photos/aaa');
  assert.ok(got && 'body' in got);
  assert.equal(await new Response(got.body).text(), 'jpeg bytes');
  const headers = new Headers();
  got.writeHttpMetadata(headers);
  assert.equal(headers.get('content-type'), 'image/jpeg');

  const conditional = await r2.get('photos/aaa', { onlyIf: new Headers({ 'if-none-match': put.httpEtag }) });
  assert.ok(conditional && !('body' in conditional), 'a matching etag gives no body (304)');

  for (let i = 0; i < 1005; i++) await r2.put(`photos/${String(i).padStart(4, '0')}`, 'x');
  await r2.put('thumbs/aaa', 'x');
  const first = await r2.list({ prefix: 'photos/', include: ['customMetadata'] });
  assert.equal(first.objects.length, 1000);
  assert.ok(first.truncated && first.cursor);
  const second = await r2.list({ prefix: 'photos/', cursor: first.cursor });
  assert.equal(second.objects.length, 6);
  assert.equal(second.truncated, false);
  assert.deepEqual(second.objects.find(o => o.key === 'photos/aaa')?.customMetadata, { width: '800' });

  await r2.delete(['photos/aaa', 'thumbs/aaa']);
  assert.equal(await r2.get('photos/aaa'), null);
  assert.equal(await r2.head('thumbs/aaa'), null);
});

test('Durable Object stand-in keeps one object per name, with its own storage, and copies results', async () => {
  class Counter {
    state = { n: 0 };
    constructor(private ctx: { storage: { get(k: string | string[]): Promise<unknown>; put(k: string, v: unknown): Promise<void>; list(o?: { prefix?: string }): Promise<Map<string, unknown>> } }) {}
    async bump() { this.state.n++; await this.ctx.storage.put('n', this.state.n); return this.state; }
    async stored() { return this.ctx.storage.get('n'); }
    async many() { return this.ctx.storage.get(['n', 'none']); }
    async all() { return this.ctx.storage.list(); }
  }
  const ns = new LocalNamespace(memoryIdb(), state => new Counter(state as never));
  const a = ns.get(ns.idFromName('a'));
  const result = await a.bump();
  result.n = 99; // must not reach the object
  assert.equal((await a.bump()).n, 2);
  assert.equal(await ns.get('a').stored(), 2);
  assert.equal(await ns.get('b').stored(), undefined, 'b has its own storage');
  assert.deepEqual(await a.many(), new Map([['n', 2]]));
  assert.deepEqual(await a.all(), new Map([['n', 2]]));
});

test('the Preferences-backed KV store round-trips text, JSON and binary, and lists by prefix', async () => {
  const { prefsStore } = await import('../src/web/app/prefsStore');
  const data = new Map<string, string>();
  const prefs = {
    get: async ({ key }: { key: string }) => ({ value: data.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { data.set(key, value); },
    remove: async ({ key }: { key: string }) => { data.delete(key); },
    keys: async () => ({ keys: [...data.keys()] }),
  } as never;
  const kv = new LocalKV(prefsStore(prefs));
  await kv.put('settings', JSON.stringify({ a: 1 }));
  await kv.put('bin', new Uint8Array([1, 2, 250]).buffer);
  await kv.put('other', 'x');
  assert.deepEqual(await kv.get('settings', 'json'), { a: 1 });
  assert.deepEqual([...new Uint8Array((await kv.get('bin', 'arrayBuffer')) as ArrayBuffer)], [1, 2, 250]);
  assert.deepEqual((await kv.list({ prefix: 's' })).keys.map(k => k.name), ['settings']);
  await kv.delete('settings');
  assert.equal(await kv.get('settings'), null);
});
