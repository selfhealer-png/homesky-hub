import { cleanFollow, isFollow } from '../shared/settings';
import type { Aircraft, TrackResponse } from '../shared/types';
import { normalize, type ReadsbAircraft } from './aircraft';
import { cached } from './cache';
import { json, USER_AGENT, type Env } from './env';
import { lookupRoute, withProgress } from './routes';
import { loadSettings } from './settings';
import { skyContext } from './sky';

// The Flight tracker: one flight, followed anywhere in the world. What was typed in /setup can
// be a flight number (BA117), a callsign (BAW117), a registration (G-XLEA) or an ICAO hex code
// (4CA8B1); some are ambiguous (BA1234 is also valid hex), so each reading is tried in turn and
// the first one in the air wins. The same community ADS-B sources as the radar answer by
// callsign, registration or hex, worldwide.

export type Lookup = { kind: 'callsign' | 'reg' | 'hex'; value: string };

const SOURCES: Array<{ name: string; url: (l: Lookup) => string }> = [
  { name: 'adsb.lol', url: l => `https://api.adsb.lol/v2/${l.kind}/${encodeURIComponent(l.value)}` },
  { name: 'airplanes.live', url: l => `https://api.airplanes.live/v2/${l.kind}/${encodeURIComponent(l.value)}` },
  { name: 'adsb.fi', url: l => `https://opendata.adsb.fi/api/v2/${l.kind === 'reg' ? 'registration' : l.kind}/${encodeURIComponent(l.value)}` },
];

const LIVE_SECONDS = 15;
/** The last sighting is written to KV at most this often, to stay well inside the free plan's writes. */
const LAST_SEEN_WRITE_MS = 10 * 60_000;
const lastWrite = new Map<string, number>();
/** The last sighting as this isolate knows it, so polls while the flight is down don't each read KV. */
const lastSeenMemo = new Map<string, { seen: TrackResponse['lastSeen'] | null; at: number }>();

/** An IATA airline code (BA, U2, 9W) to its ICAO code (BAW, EZY, JAI), from adsbdb. Cached a month. */
async function icaoAirline(env: Env, iata: string): Promise<string | null> {
  return cached<string | null>(env, `airline:v1:${iata}`, v => (v ? 30 * 86_400 : 86_400), async () => {
    const res = await fetch(`https://api.adsbdb.com/v0/airline/${iata}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`adsbdb answered ${res.status}`);
    const body = (await res.json()) as { response: string | Array<{ icao?: string; iata?: string }> };
    return Array.isArray(body.response) ? body.response.find(a => a.iata === iata && a.icao)?.icao ?? null : null;
  }).catch(() => null);
}

/** Every reading of what was typed, most likely first. */
export async function lookupsFor(env: Env, query: string): Promise<Lookup[]> {
  const q = cleanFollow(query);
  if (!isFollow(q)) return [];
  if (q.includes('-')) return [{ kind: 'reg', value: q }];
  const out: Lookup[] = [];
  // An ICAO callsign: three letters and a number.
  if (/^[A-Z]{3}\d[0-9A-Z]{0,4}$/.test(q)) out.push({ kind: 'callsign', value: q });
  // A flight number: a two-character IATA airline code (one of them a letter) and up to four digits.
  const flight = q.match(/^([A-Z]\d|\d[A-Z]|[A-Z]{2})0*(\d{1,4}[A-Z]?)$/);
  if (flight) {
    const icao = await icaoAirline(env, flight[1]);
    if (icao) out.push({ kind: 'callsign', value: `${icao}${flight[2]}` });
  }
  if (/^[0-9A-F]{6}$/.test(q)) out.push({ kind: 'hex', value: q.toLowerCase() });
  // Anything else short: a callsign as it is (private flights use their registration), or a
  // registration written without its dash (N-numbers never have one).
  if (!out.length) out.push({ kind: 'callsign', value: q }, { kind: 'reg', value: q });
  return out;
}

export async function fetchLookup(env: Env, l: Lookup): Promise<{ source: string; aircraft: ReadsbAircraft[] }> {
  return cached(env, `track:${l.kind}:${l.value}`, LIVE_SECONDS, async () => {
    const errors: string[] = [];
    for (const s of SOURCES) {
      try {
        const res = await fetch(s.url(l), { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const body = (await res.json()) as { ac?: ReadsbAircraft[]; aircraft?: ReadsbAircraft[] };
        return { source: s.name, aircraft: body.ac ?? body.aircraft ?? [] };
      } catch (err) {
        errors.push(`${s.name}: ${(err as Error).message}`);
      }
    }
    throw new Error(errors.join('; '));
  });
}

/** Finds the followed flight in the air (or on the ground with a position), measured from home. */
export async function findFollowed(env: Env, query: string, home: { lat: number; lon: number }): Promise<{ aircraft: Aircraft | null; source?: string }> {
  let source: string | undefined;
  for (const l of await lookupsFor(env, query)) {
    const found = await fetchLookup(env, l).catch(() => null);
    if (!found) continue;
    source = found.source;
    const list = found.aircraft.map(a => normalize(a, home.lat, home.lon)).filter((a): a is Aircraft => !!a);
    // A reused callsign can turn up twice; the one in the air is the one being followed.
    const pick = list.find(a => a.altFt !== null) ?? list[0];
    if (pick) return { aircraft: pick, source: found.source };
  }
  return { aircraft: null, source };
}

/** A test for whether an aircraft already in view is the one being followed, without asking any source. */
export async function followMatcher(env: Env, query: string): Promise<(a: Aircraft) => boolean> {
  const lookups = await lookupsFor(env, query);
  const flat = (r: string) => r.replace(/-/g, '');
  return a => lookups.some(l =>
    l.kind === 'hex' ? a.hex === l.value
      : l.kind === 'reg' ? !!a.registration && flat(a.registration) === flat(l.value)
        : a.callsign === l.value);
}

export async function handleTrack(env: Env, url: URL, request: Request): Promise<Response> {
  const query = (await loadSettings(env)).sky?.follow;
  if (!query) return json({ error: 'No flight chosen. Choose one in /setup.' }, { status: 404 });
  // Distance and bearing are from the display's place; without one, they're simply not shown.
  const home = await skyContext(env, url, request).then(s => s.home, () => null);
  const { aircraft, source } = await findFollowed(env, query, home ?? { lat: 0, lon: 0 });
  if (aircraft && !home) aircraft.distanceNm = aircraft.bearingDeg = NaN;

  const lastKey = `track:last:${query}`;
  if (aircraft) {
    const stored = aircraft.callsign ? await lookupRoute(env, aircraft.callsign) : null;
    if (env.HUB_KV && Date.now() - (lastWrite.get(query) ?? 0) > LAST_SEEN_WRITE_MS) {
      lastWrite.set(query, Date.now());
      const seen: TrackResponse['lastSeen'] = { at: Date.now(), callsign: aircraft.callsign, lat: aircraft.lat, lon: aircraft.lon };
      lastSeenMemo.set(query, { seen, at: Date.now() });
      await env.HUB_KV.put(lastKey, JSON.stringify(seen), { expirationTtl: 14 * 86_400 }).catch(() => {});
    }
    return json({ query, fetchedAt: Date.now(), source, aircraft, route: stored && withProgress(stored, aircraft) } satisfies TrackResponse);
  }
  // Another isolate may have seen it since, so the remembered answer is only trusted as long as
  // the gap between writes.
  let memo = lastSeenMemo.get(query);
  if (!memo || Date.now() - memo.at > LAST_SEEN_WRITE_MS) {
    const seen = (await env.HUB_KV?.get(lastKey, 'json').catch(() => null)) as TrackResponse['lastSeen'] | null;
    memo = { seen, at: Date.now() };
    lastSeenMemo.set(query, memo);
  }
  const lastSeen = memo.seen;
  return json({ query, fetchedAt: Date.now(), source, aircraft: null, route: null, lastSeen: lastSeen ?? undefined } satisfies TrackResponse);
}
