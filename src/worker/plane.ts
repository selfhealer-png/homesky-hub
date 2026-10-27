import { aboutType, typeArticleTitle } from '../shared/notable';
import type { Aircraft, PlaneDetail, TypeArticle } from '../shared/types';
import { normalize, type ReadsbAircraft } from './aircraft';
import { cached } from './cache';
import { json, USER_AGENT, type Env } from './env';
import { lookupRoute, withProgress } from './routes';
import { skyContext } from './sky';
import { fetchLookup } from './track';

// The plane card: everything known about one aircraft, asked for by its ICAO hex code when
// someone taps a plane or an alert. Live figures come from the same community ADS-B sources as
// the radar (looked up by hex, cached for 15 s). Who owns it, where it's registered and a photo
// of the aircraft itself come from adsbdb, as does the route, and a few lines about the type
// from Wikipedia. The last three are cached for weeks, so each is looked up about once.

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function handlePlane(env: Env, url: URL, request: Request): Promise<Response> {
  const hex = (url.searchParams.get('hex') ?? '').toLowerCase();
  if (!/^~?[0-9a-f]{6}$/.test(hex)) return json({ error: 'Expected an ICAO hex code' }, { status: 400 });
  const home = await skyContext(env, url, request).then(s => s.home, () => ({ lat: 0, lon: 0 }));

  let raw: ReadsbAircraft | undefined;
  let source: string | undefined;
  try {
    const found = await fetchLookup(env, { kind: 'hex', value: hex.replace('~', '') });
    raw = found.aircraft.find(a => a.hex.toLowerCase() === hex) ?? found.aircraft[0];
    source = found.source;
  } catch {
    // Every source refused: the card still shows what the display already knows.
  }
  const aircraft = raw ? normalize(raw, home.lat, home.lon) : null;
  const route = aircraft?.callsign ? await lookupRoute(env, aircraft.callsign).then(r => r && withProgress(r, aircraft)) : null;
  const year = Number(raw?.year);
  const db = await registry(env, hex.replace('~', ''));
  // Not every feed knows the type by name; the registry usually does.
  if (aircraft && !aircraft.desc && db?.manufacturer && db.type) aircraft.desc = `${db.manufacturer} ${db.type}`;

  const detail: PlaneDetail = {
    hex,
    fetchedAt: Date.now(),
    source,
    aircraft,
    route,
    operator: raw?.ownOp?.trim() || (db?.registered_owner && db.registered_owner !== 'Private' ? db.registered_owner : null),
    country: db?.registered_owner_country_name ?? null,
    photo: db?.url_photo ?? null,
    year: Number.isInteger(year) && year > 1900 ? year : null,
    category: raw?.category ?? null,
    positionSource: raw?.type ?? null,
    live: {
      iasKt: num(raw?.ias), tasKt: num(raw?.tas), mach: num(raw?.mach),
      selectedAltFt: num(raw?.nav_altitude_mcp),
      selectedHeadingDeg: num(raw?.nav_heading),
      navModes: Array.isArray(raw?.nav_modes) ? raw.nav_modes.filter(m => typeof m === 'string') : null,
      rollDeg: num(raw?.roll),
      windFromDeg: num(raw?.wd), windKt: num(raw?.ws), outsideTempC: num(raw?.oat),
    },
    article: aircraft ? await typeArticle(env, aircraft) : null,
  };
  return json(detail);
}

interface AdsbdbAircraft {
  type?: string; manufacturer?: string; registered_owner?: string;
  registered_owner_country_name?: string; url_photo?: string | null;
}

/** The aircraft's entry in adsbdb's registry: maker, type, owner, country, a photo. */
async function registry(env: Env, hex: string): Promise<AdsbdbAircraft | null> {
  return cached<AdsbdbAircraft | null>(env, `aircraft:v1:${hex}`, v => (v ? 30 * 86_400 : 7 * 86_400), async () => {
    const res = await fetch(`https://api.adsbdb.com/v0/aircraft/${hex}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`adsbdb answered ${res.status}`);
    const body = (await res.json()) as { response: string | { aircraft?: AdsbdbAircraft } };
    return typeof body.response === 'object' ? body.response.aircraft ?? null : null;
  }).catch(() => null);
}

interface SearchPage {
  index?: number; title: string; extract?: string; fullurl?: string;
  thumbnail?: { source: string; width: number; height: number };
}

/** A few lines about the aircraft's type. Misses are remembered for a day, finds for a month. */
async function typeArticle(env: Env, a: Aircraft): Promise<TypeArticle | null> {
  // Rare types and the common airliners name their article; anything else is searched for by
  // its type name, then with "aircraft" added for names that are also something else.
  const title = typeArticleTitle(a.type);
  const name = a.desc;
  if (!title && !name) return null;
  return cached<TypeArticle | null>(env, `type:v2:${(title ?? name!).toLowerCase()}`, v => (v ? 30 * 86_400 : 86_400), async () => {
    if (title) return pickPage(await query({ titles: title }), title);
    for (const q of [name!, `${name} aircraft`]) {
      const found = pickPage(await query({ generator: 'search', gsrsearch: q, gsrlimit: '4' }), name!);
      if (found) return found;
    }
    return null;
  }).catch(() => null);
}

async function query(pick: Record<string, string>): Promise<SearchPage[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', redirects: '1', ...pick,
    prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1', exsentences: '3', exlimit: '4',
    // 500 px is one of Wikimedia's standard thumbnail widths; others are refused.
    piprop: 'thumbnail', pithumbsize: '500', pilimit: '4', inprop: 'url',
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'user-agent': `${USER_AGENT} (open-source home display)`, accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const body = (await res.json()) as { query?: { pages?: SearchPage[] } };
  return (body.query?.pages ?? []).sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
}

/** The first result that's about the type (see aboutType). */
function pickPage(pages: SearchPage[], name: string): TypeArticle | null {
  const page = pages.find(p => p.extract && aboutType(p.title, name));
  if (!page?.extract || !page.fullurl) return null;
  const t = page.thumbnail;
  return { title: page.title, extract: page.extract, url: page.fullurl, image: t ? { url: t.source, width: t.width, height: t.height } : undefined };
}
