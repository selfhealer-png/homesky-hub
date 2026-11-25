import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedSources, fetchFeed, type Env } from '../src/worker/env';
// @ts-expect-error: plain JavaScript, run by Node on the relay server
import { makeRelay } from '../relay/adsb-relay.mjs';

const TOKEN = 'x'.repeat(48);

function fakeFetch(calls: string[], status = 200) {
  return async (url: string) => {
    calls.push(url);
    return new Response('{"ac":[]}', { status, headers: { 'content-type': 'application/json', 'retry-after': '30' } });
  };
}

test('the Worker goes straight to the feed without a relay, through it with one', async () => {
  const seen: Array<{ url: string; auth?: string }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
    return new Response('{}');
  }) as typeof fetch;
  try {
    const feed = 'https://api.adsb.lol/v2/point/51.5/-0.1/25?x=1';
    await fetchFeed({} as Env, feed);
    await fetchFeed({ ADSB_RELAY_URL: 'https://relay.example/ ', ADSB_RELAY_TOKEN: 'tok' } as Env, feed, { headers: { accept: 'application/json' } });
    await fetchFeed({ ADSB_RELAY_URL: 'https://relay.example' } as Env, 'https://api.adsbdb.com/v0/callsign/BAW1');
    assert.deepEqual(seen, [
      { url: feed, auth: undefined },
      { url: 'https://relay.example/api.adsb.lol/v2/point/51.5/-0.1/25?x=1', auth: 'Bearer tok' },
      { url: 'https://api.adsbdb.com/v0/callsign/BAW1', auth: undefined },
    ]);
  } finally {
    globalThis.fetch = real;
  }
});

test('the relay needs its token and only relays the feed hosts', async () => {
  const calls: string[] = [];
  const relay = makeRelay({ token: TOKEN, fetch: fakeFetch(calls) });
  assert.equal((await relay('GET', '/health', undefined)).status, 200);
  assert.equal((await relay('GET', '/api.adsb.lol/v2/point/1/2/3', undefined)).status, 401);
  assert.equal((await relay('GET', '/api.adsb.lol/v2/point/1/2/3', 'Bearer wrong')).status, 401);
  assert.equal((await relay('POST', '/api.adsb.lol/v2/point/1/2/3', `Bearer ${TOKEN}`)).status, 405);
  assert.equal((await relay('GET', '/example.com/anything', `Bearer ${TOKEN}`)).status, 404);
  assert.equal((await relay('GET', '/169.254.169.254/latest', `Bearer ${TOKEN}`)).status, 404);
  assert.deepEqual(calls, []);

  const ok = await relay('GET', '/opendata.adsb.fi/api/v2/lat/1/lon/2/dist/3', `Bearer ${TOKEN}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), '{"ac":[]}');
  assert.deepEqual(calls, ['https://opendata.adsb.fi/api/v2/lat/1/lon/2/dist/3']);
});

test('the relay keeps good answers a few seconds and passes refusals on', async () => {
  let now = 1_000_000;
  const calls: string[] = [];
  const relay = makeRelay({ token: TOKEN, fetch: fakeFetch(calls), now: () => now });
  const path = '/api.adsb.lol/v2/point/1/2/3';
  await relay('GET', path, `Bearer ${TOKEN}`);
  await relay('GET', path, `Bearer ${TOKEN}`);
  assert.equal(calls.length, 1);
  now += 6_000;
  await relay('GET', path, `Bearer ${TOKEN}`);
  assert.equal(calls.length, 2);

  const refused = makeRelay({ token: TOKEN, fetch: fakeFetch([], 429) });
  const out = await refused('GET', path, `Bearer ${TOKEN}`);
  assert.equal(out.status, 429);
  assert.equal(out.headers['retry-after'], '30');
});

test('the relay will not start with a short or missing token', () => {
  assert.throws(() => makeRelay({ token: undefined }));
  assert.throws(() => makeRelay({ token: 'short' }));
});

test('AIRCRAFT_SOURCES picks the feeds and the order they are tried in', () => {
  const all = [{ name: 'adsb.lol' }, { name: 'adsb.fi' }, { name: 'airplanes.live' }];
  const names = (v?: string) => allowedSources({ AIRCRAFT_SOURCES: v } as Env, all).map(s => s.name);
  assert.deepEqual(names(undefined), ['adsb.lol', 'adsb.fi', 'airplanes.live']);
  assert.deepEqual(names('adsb.fi, adsb.lol'), ['adsb.fi', 'adsb.lol']);
  assert.deepEqual(names('adsb.lol'), ['adsb.lol']);
  assert.deepEqual(names('nope,adsb.fi,adsb.fi'), ['adsb.fi']);
});

test('airlines: sub-brands show as the airline people know, and callsigns give the code', async () => {
  const { airlineFor, callsignAirline } = await import('../src/worker/routes');
  assert.equal(callsignAirline('SHT9B'), 'SHT');
  assert.equal(callsignAirline('BAW117'), 'BAW');
  assert.equal(callsignAirline('GABCD'), null);
  const env = {} as Env;
  assert.deepEqual(await airlineFor(env, 'SHT9B', null), { name: 'British Airways', iata: 'BA' });
  assert.deepEqual(await airlineFor(env, 'CFE45P', { name: 'BA CityFlyer', icao: 'CFE', iata: 'CJ' }), { name: 'British Airways', iata: 'BA' });
  assert.deepEqual(await airlineFor(env, 'XYZ123', { name: 'Some Air', icao: 'XYZ', iata: 'S9' }), { name: 'Some Air', iata: 'S9' });
});

test('routes: when adsbdb has no route, the VRS data gives it, on the leg being flown', async () => {
  const { lookupRoute, withProgress } = await import('../src/worker/routes');
  const real = globalThis.fetch;
  const lhr = { name: 'London Heathrow Airport', icao: 'EGLL', iata: 'LHR', location: 'London', countryiso2: 'GB', lat: 51.4706, lon: -0.461941 };
  const edi = { name: 'Edinburgh Airport', icao: 'EGPH', iata: 'EDI', location: 'Edinburgh', countryiso2: 'GB', lat: 55.95, lon: -3.3725 };
  globalThis.fetch = (async (url: string) => {
    if (url.includes('adsbdb')) return new Response(JSON.stringify({ response: 'unknown callsign' }), { status: 404 });
    if (url.endsWith('/routes/SH/SHT8Y.json')) return new Response(JSON.stringify({ airline_code: 'SHT', _airports: [lhr, edi, lhr] }));
    return new Response('', { status: 503 });
  }) as typeof fetch;
  try {
    const stored = await lookupRoute({} as Env, 'SHT8Y');
    assert.ok(stored);
    assert.equal(stored.airline?.name, 'British Airways');
    // Over Carlisle, heading north: the Heathrow → Edinburgh leg, not the way back.
    const r = withProgress(stored, { lat: 54.86, lon: -2.88, altFt: 23_000, trackDeg: 337, onGround: false } as never);
    assert.equal(r?.origin.iata, 'LHR');
    assert.equal(r?.destination.iata, 'EDI');
    assert.equal(await lookupRoute({} as Env, 'ZZZ999'), null);
  } finally {
    globalThis.fetch = real;
  }
});
