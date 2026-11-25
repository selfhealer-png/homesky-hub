#!/usr/bin/env node
// A tiny relay for the community ADS-B feeds, for a hub whose Worker is refused by them.
//
// The feeds limit or block Cloudflare's shared addresses, and they don't let a web page call
// them directly. This runs on a small server with an address of its own (Oracle Cloud's free
// tier, see docs/RELAY.md) and fetches for the Worker:
//
//   GET /<feed host>/<path>   with   Authorization: Bearer <RELAY_TOKEN>
//   →  https://<feed host>/<path>, answered as the feed answered (status, body, Retry-After)
//
// Only the feed hosts below are relayed, only GET, only with the token: it is not an open proxy.
// Answers are kept a few seconds, so several screens or a retry don't each reach the feed.
// No dependencies; Node 18 or later. Listens on 127.0.0.1 only: Caddy in front gives it HTTPS.
// Started by server.mjs.

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const RELAYED_HOSTS = ['api.adsb.lol', 'opendata.adsb.fi', 'api.airplanes.live'];
const USER_AGENT = 'homesky-hub-relay/0.1';
const KEEP_MS = 5_000;
const MAX_KEPT = 200;
const PASSED_HEADERS = ['content-type', 'retry-after', 'x-rate-limit-retry-after-seconds', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

function sameToken(given, expected) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * One request to the relay, as plain values so it can be tested without a server.
 * `deps.fetch` and `deps.now` stand in for the real ones in tests.
 */
export function makeRelay({ token, fetch: doFetch = fetch, now = Date.now }) {
  if (!token || token.length < 24) throw new Error('RELAY_TOKEN must be set, 24 characters or more');
  const kept = new Map(); // url → { at, status, headers, body }

  return async function relay(method, path, authorization) {
    if (path === '/health') return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok\n' };
    if (!sameToken(authorization, `Bearer ${token}`)) return { status: 401, headers: { 'content-type': 'text/plain' }, body: 'Unauthorized\n' };
    if (method !== 'GET') return { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET' }, body: 'Only GET\n' };

    const m = path.match(/^\/([a-z0-9.-]+)(\/[^\s]*)$/i);
    const host = m?.[1].toLowerCase();
    if (!m || !RELAYED_HOSTS.includes(host)) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not a relayed feed\n' };
    const target = `https://${host}${m[2]}`;

    const hit = kept.get(target);
    if (hit && now() - hit.at < KEEP_MS) return hit;

    let res;
    try {
      res = await doFetch(target, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    } catch (err) {
      return { status: 504, headers: { 'content-type': 'text/plain' }, body: `${host} did not answer: ${err?.name === 'TimeoutError' ? 'timed out' : err?.message}\n` };
    }
    const headers = {};
    for (const h of PASSED_HEADERS) {
      const v = res.headers.get(h);
      if (v != null) headers[h] = v;
    }
    const answer = { at: now(), status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
    if (res.ok) {
      if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value);
      kept.set(target, answer);
    }
    return answer;
  };
}

export function startServer({ token, port = 8787, host = '127.0.0.1' }) {
  const relay = makeRelay({ token });
  const server = createServer(async (req, res) => {
    const started = Date.now();
    try {
      const out = await relay(req.method ?? 'GET', req.url ?? '/', req.headers.authorization);
      res.writeHead(out.status, { ...out.headers, 'cache-control': 'no-store' });
      res.end(out.body);
      if (req.url !== '/health') console.log(`${out.status} ${req.url?.split('?')[0]} ${Date.now() - started}ms`);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Relay error\n');
    }
  });
  server.listen(port, host, () => console.log(`ADS-B relay on http://${host}:${port}`));
  return server;
}
