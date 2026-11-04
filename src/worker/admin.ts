import {
  CALENDAR_COLORS, CLOCK_STYLES, DEFAULT_NIGHT, MAX_AIRPORTS, MOTION_LEVELS, NIGHT_MODES, PHOTO_STYLES, RADAR_MAPS, RADIUS_CHOICES, WARMTH_LEVELS, secretKey,
  ROTATE_CHOICES, SCREEN_IDS, SCREEN_SEC_STEPS, cleanFollow, isClockTime, isFollow, type ClockStyle, type GoogleWants, type ScreenId, type MotionLevel, type NightSettings,
  type AdminState, type Place, type SavedAirport, type Connection, type ConnectionTest, type FeedConnection, type GoogleConnection, type GoogleItem, type IcsConnection, type Settings,
} from '../shared/settings';
import { ALERT_LEVELS } from '../shared/notable';
import { screenOrder } from '../shared/rotation';
import { handleLogin, handleLogout, hmac, isAdmin, passesCsrfCheck, safeEqual } from './adminAuth';
import { readConnection } from './agenda';
import { json, type Env } from './env';
import { agendaWindow, ProviderError } from './providers/common';
import { exchangeCode, googleAuthUrl, listGoogleChoices } from './providers/google';
import { deletePhotos, listPhotos, pollPicking, servePhoto, setCaptions, startPicking } from './photos';
import { loadSecrets, loadSettings, saveSettings, SettingsUnavailable, updateSecrets } from './settings';

// The /setup page's API. Every route except login needs an admin session, and every POST also
// needs the X-Hub-Admin header (see adminAuth.ts).

const GOOGLE_CALLBACK = '/setup/google/callback';

class BadRequest extends Error {}

const str = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest(`${field} is required.`);
  if (v.length > max) throw new BadRequest(`${field} is too long.`);
  return v.trim();
};
const color = (v: unknown): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : CALENDAR_COLORS[0]);
const newId = () => crypto.randomUUID().slice(0, 8);

function linkHost(url: string): string {
  try {
    const u = new URL(url.trim().replace(/^webcals?:\/\//i, 'https://'));
    if (u.protocol !== 'https:') throw new Error();
    return u.host;
  } catch {
    throw new BadRequest('The link must be a full https:// or webcal:// address.');
  }
}

export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD is not set on this hub. Run `npm run setup`.' }, { status: 503 });
  try {
    if (path === '/api/admin/login' && request.method === 'POST') return await handleLogin(request, env);
    if (path === '/api/admin/logout' && request.method === 'POST') return handleLogout();
    if (path === GOOGLE_CALLBACK) return await googleCallback(env, url);

    if (!(await isAdmin(request, env))) return json({ error: 'Not signed in.' }, { status: 401 });
    if (!passesCsrfCheck(request)) return json({ error: 'Missing X-Hub-Admin header.' }, { status: 403 });

    const thumb = path.match(/^\/api\/admin\/photos\/thumb\/([0-9a-f]{20})$/);
    if (thumb) return await servePhoto(env, 'thumbs', thumb[1], request);

    const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    switch (path) {
      case '/api/admin/state': return json(await state(env, url));
      case '/api/admin/connections/add': return json(await addConnection(env, body));
      case '/api/admin/connections/update': return json(await updateConnection(env, body));
      case '/api/admin/connections/delete': return json(await deleteConnection(env, body));
      case '/api/admin/connections/test': return json(await testConnection(env, body));
      case '/api/admin/google/client': return json(await saveGoogleClient(env, body));
      case '/api/admin/google/start': return json(await googleStart(env, url, body));
      case '/api/admin/google/choices': return json(await googleChoices(env));
      case '/api/admin/google/selection': return json(await googleSelection(env, body));
      case '/api/admin/google/disconnect': return json(await googleDisconnect(env));
      case '/api/admin/sky': return json(await saveSky(env, body));
      case '/api/admin/display': return json(await saveDisplay(env, body));
      case '/api/admin/photos': return json(await listPhotos(env));
      case '/api/admin/photos/pick': return json(await startPicking(env, str(body.collection ?? 'Photos', 'Collection', 40)));
      case '/api/admin/photos/poll': return json(await pollPicking(env, str(body.sessionId, 'Session', 200)));
      case '/api/admin/photos/delete': return json(await deletePhotos(env, body));
      case '/api/admin/photos/caption': return json(await setCaptions(env, body));
      default: return json({ error: 'Not found' }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof BadRequest || err instanceof ProviderError) return json({ error: err.message }, { status: 400 });
    if (err instanceof SettingsUnavailable) return json({ error: err.message }, { status: 503 });
    throw err;
  }
}

async function state(env: Env, url: URL): Promise<AdminState> {
  return {
    settings: await loadSettings(env),
    status: {
      kv: !!env.HUB_KV,
      photos: !!env.PHOTOS,
      displayPairing: env.DISPLAY_TOKEN ? `${url.origin}/pair#${env.DISPLAY_TOKEN}` : null,
      origin: url.origin,
      googleRedirectUri: `${url.origin}${GOOGLE_CALLBACK}`,
      envFeed: !!env.AGENDA_FEED_URL,
    },
  };
}

async function mutate(env: Env, fn: (s: Settings) => Settings): Promise<Settings> {
  const next = fn(structuredClone(await loadSettings(env)));
  await saveSettings(env, next);
  return next;
}

function find(settings: Settings, id: unknown): Connection {
  const conn = settings.connections.find(c => c.id === id);
  if (!conn) throw new BadRequest('That connection no longer exists.');
  return conn;
}

async function addConnection(env: Env, b: Record<string, unknown>) {
  const id = newId();
  if (b.kind === 'ics') {
    const link = str(b.url, 'Calendar link', 2000);
    const conn: IcsConnection = { id, kind: 'ics', name: str(b.name, 'Name', 60), color: color(b.color), enabled: true, host: linkHost(link) };
    await updateSecrets(env, { [secretKey.icsUrl(id)]: link });
    return mutate(env, s => ({ ...s, connections: [...s.connections, conn] }));
  }
  if (b.kind === 'feed') {
    const feedUrl = str(b.url, 'Feed URL', 2000);
    linkHost(feedUrl);
    const token = typeof b.token === 'string' && b.token.trim() ? b.token.trim() : null;
    const conn: FeedConnection = { id, kind: 'feed', name: str(b.name, 'Name', 60), enabled: true, url: feedUrl, hasToken: !!token };
    if (token) await updateSecrets(env, { [secretKey.feedToken(id)]: token });
    return mutate(env, s => ({ ...s, connections: [...s.connections, conn] }));
  }
  throw new BadRequest('Unknown connection type.');
}

async function updateConnection(env: Env, b: Record<string, unknown>) {
  const current = find(await loadSettings(env), b.id);
  if (current.kind === 'ics' && typeof b.url === 'string' && b.url.trim()) {
    const host = linkHost(b.url);
    await updateSecrets(env, { [secretKey.icsUrl(current.id)]: b.url.trim() });
    (b as { host?: string }).host = host;
  }
  if (current.kind === 'feed' && typeof b.token === 'string') {
    await updateSecrets(env, { [secretKey.feedToken(current.id)]: b.token.trim() || null });
    b.hasToken = !!b.token.trim();
  }
  return mutate(env, s => {
    const conn = find(s, b.id) as Connection & Record<string, unknown>;
    if (typeof b.enabled === 'boolean') conn.enabled = b.enabled;
    if (conn.kind !== 'google' && typeof b.name === 'string' && b.name.trim()) conn.name = str(b.name, 'Name', 60);
    if (conn.kind === 'ics' && b.color) conn.color = color(b.color);
    if (conn.kind === 'ics' && typeof (b as { host?: string }).host === 'string') conn.host = (b as { host: string }).host;
    if (conn.kind === 'feed' && typeof b.url === 'string' && b.url.trim()) { linkHost(b.url); conn.url = b.url.trim(); }
    if (conn.kind === 'feed' && typeof b.hasToken === 'boolean') conn.hasToken = b.hasToken;
    return s;
  });
}

async function deleteConnection(env: Env, b: Record<string, unknown>) {
  const conn = find(await loadSettings(env), b.id);
  if (conn.kind === 'google') return googleDisconnect(env, true);
  await updateSecrets(env, { [secretKey.icsUrl(conn.id)]: null, [secretKey.feedToken(conn.id)]: null });
  return mutate(env, s => ({ ...s, connections: s.connections.filter(c => c.id !== conn.id) }));
}

/** Tests a saved connection by id, or an unsaved one from the form (kind + url [+ token]). */
async function testConnection(env: Env, b: Record<string, unknown>): Promise<ConnectionTest> {
  let conn: Connection;
  let secrets: Record<string, string>;
  if (typeof b.id === 'string') {
    conn = find(await loadSettings(env), b.id);
    secrets = await loadSecrets(env);
  } else if (b.kind === 'ics') {
    conn = { id: 'test', kind: 'ics', name: 'Test', color: CALENDAR_COLORS[0], enabled: true, host: linkHost(str(b.url, 'Calendar link', 2000)) };
    secrets = { [secretKey.icsUrl('test')]: str(b.url, 'Calendar link', 2000) };
  } else if (b.kind === 'feed') {
    conn = { id: 'test', kind: 'feed', name: 'Test', enabled: true, url: str(b.url, 'Feed URL', 2000), hasToken: !!b.token };
    secrets = typeof b.token === 'string' ? { [secretKey.feedToken('test')]: b.token } : {};
  } else {
    throw new BadRequest('Nothing to test.');
  }

  try {
    const r = await readConnection(env, conn, secrets);
    const { start } = agendaWindow();
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = r.events
      .filter(e => e.start >= (e.allDay ? today : start.toISOString()))
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 3)
      .map(e => e.title);
    return { ok: true, events: r.events.length, tasks: r.tasks.length, upcoming };
  } catch (err) {
    return { ok: false, events: 0, tasks: 0, upcoming: [], error: err instanceof ProviderError ? err.message : 'Could not read it.' };
  }
}

// ── Google ──────────────────────────────────────────────────────────────────

function googleConn(settings: Settings): GoogleConnection | undefined {
  return settings.connections.find((c): c is GoogleConnection => c.kind === 'google');
}

async function saveGoogleClient(env: Env, b: Record<string, unknown>) {
  const clientId = str(b.clientId, 'Client ID', 200);
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new BadRequest('The Client ID should end in .apps.googleusercontent.com.');
  if (typeof b.clientSecret === 'string' && b.clientSecret.trim()) await updateSecrets(env, { [secretKey.googleClientSecret]: b.clientSecret.trim() });
  else if (!(await loadSecrets(env))[secretKey.googleClientSecret]) throw new BadRequest('Client secret is required.');
  return mutate(env, s => {
    const existing = googleConn(s);
    if (existing) {
      // A different OAuth client can't use the old refresh token.
      if (existing.clientId !== clientId) existing.account = null;
      existing.clientId = clientId;
      return s;
    }
    return { ...s, connections: [...s.connections, { id: 'google', kind: 'google', enabled: true, clientId, account: null, calendars: [], taskLists: [] }] };
  });
}

// OAuth state: "<expiry>.<nonce>.<hmac>". The callback is a cross-site navigation from Google,
// so the SameSite=Strict admin cookie isn't sent with it; the signed state stands in for it.
async function googleStart(env: Env, url: URL, b: Record<string, unknown>) {
  const conn = googleConn(await loadSettings(env));
  if (!conn) throw new BadRequest('Save the Google Client ID and secret first.');
  // What to use Google for: chosen on the setup page, remembered for next time.
  const asked = b.wants as Partial<GoogleWants> | undefined;
  const wants: GoogleWants = asked
    ? { calendar: !!asked.calendar, tasks: !!asked.tasks, photos: !!asked.photos }
    : conn.wants ?? { calendar: true, tasks: true, photos: true };
  if (!wants.calendar && !wants.tasks && !wants.photos) throw new BadRequest('Choose at least one thing to use Google for.');
  if (asked) await mutate(env, s => { googleConn(s)!.wants = wants; return s; });
  const payload = `${Date.now() + 10 * 60_000}.${newId()}`;
  return { url: googleAuthUrl(conn.clientId, `${url.origin}${GOOGLE_CALLBACK}`, `${payload}.${await hmac(env, `google-state:${payload}`)}`, wants) };
}

async function googleCallback(env: Env, url: URL): Promise<Response> {
  const back = (params: string) => Response.redirect(`${url.origin}/setup?${params}#/accounts`, 302);
  const [expiry, nonce, sig] = (url.searchParams.get('state') ?? '').split('.');
  if (!expiry || !nonce || !sig || Number(expiry) < Date.now() || !safeEqual(sig, await hmac(env, `google-state:${expiry}.${nonce}`))) {
    return back('google=expired');
  }
  if (url.searchParams.get('error')) return back(`google=${encodeURIComponent(url.searchParams.get('error')!)}`);

  const settings = await loadSettings(env);
  const conn = googleConn(settings);
  const clientSecret = (await loadSecrets(env))[secretKey.googleClientSecret];
  if (!conn || !clientSecret) return back('google=not-configured');

  try {
    const { refreshToken, account, scopes } = await exchangeCode(conn.clientId, clientSecret, url.searchParams.get('code') ?? '', `${url.origin}${GOOGLE_CALLBACK}`);
    await updateSecrets(env, { [secretKey.googleRefreshToken]: refreshToken });
    const choices = await listGoogleChoices({ clientId: conn.clientId, clientSecret, refreshToken }, { scopes });
    await mutate(env, s => {
      const g = googleConn(s)!;
      g.account = account;
      g.scopes = scopes;
      g.enabled = true;
      g.calendars = mergeChoices(g.calendars, choices.calendars);
      g.taskLists = mergeChoices(g.taskLists, choices.taskLists);
      return s;
    });
    return back('google=connected');
  } catch {
    return back('google=failed');
  }
}

/** Keeps the person's ticks and colours for items that still exist; adds new ones. */
function mergeChoices(saved: GoogleItem[], fresh: GoogleItem[]): GoogleItem[] {
  return fresh.map(f => {
    const s = saved.find(x => x.id === f.id);
    return s ? { ...f, enabled: s.enabled, color: s.color } : f;
  });
}

async function googleChoices(env: Env) {
  const settings = await loadSettings(env);
  const conn = googleConn(settings);
  const secrets = await loadSecrets(env);
  if (!conn?.account || !secrets[secretKey.googleRefreshToken]) throw new BadRequest('Google is not connected.');
  const choices = await listGoogleChoices({ clientId: conn.clientId, clientSecret: secrets[secretKey.googleClientSecret], refreshToken: secrets[secretKey.googleRefreshToken] }, conn);
  return mutate(env, s => {
    const g = googleConn(s)!;
    g.calendars = mergeChoices(g.calendars, choices.calendars);
    g.taskLists = mergeChoices(g.taskLists, choices.taskLists);
    return s;
  });
}

async function googleSelection(env: Env, b: Record<string, unknown>) {
  const pick = (saved: GoogleItem[], incoming: unknown) => {
    const list = Array.isArray(incoming) ? (incoming as Array<Partial<GoogleItem>>) : [];
    return saved.map(item => {
      const change = list.find(x => x.id === item.id);
      return change ? { ...item, enabled: !!change.enabled, color: change.color ? color(change.color) : item.color } : item;
    });
  };
  return mutate(env, s => {
    const g = googleConn(s);
    if (!g) throw new BadRequest('Google is not set up.');
    g.calendars = pick(g.calendars, b.calendars);
    g.taskLists = pick(g.taskLists, b.taskLists);
    return s;
  });
}

async function googleDisconnect(env: Env, remove = false) {
  const token = (await loadSecrets(env))[secretKey.googleRefreshToken];
  // Best effort: also tell Google to forget the grant.
  if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  await updateSecrets(env, remove
    ? { [secretKey.googleRefreshToken]: null, [secretKey.googleClientSecret]: null }
    : { [secretKey.googleRefreshToken]: null });
  return mutate(env, s => {
    if (remove) return { ...s, connections: s.connections.filter(c => c.kind !== 'google') };
    const g = googleConn(s);
    if (g) g.account = null;
    return s;
  });
}

// ── Sky ─────────────────────────────────────────────────────────────────────

async function saveSky(env: Env, b: Record<string, unknown>) {
  const raw = Array.isArray(b.places) ? (b.places as Array<Partial<Place>>) : [];
  if (raw.length > 12) throw new BadRequest('Up to 12 places.');
  const places: Place[] = raw.map(cleanPlace);
  const active = b.active === 'device' ? 'device' : places.find(p => p.id === b.active)?.id ?? places[0]?.id ?? 'default';
  const radiusNm = RADIUS_CHOICES.includes(Number(b.radiusNm)) ? Number(b.radiusNm) : 25;
  const map = RADAR_MAPS.find(m => m === b.map);
  const airports = Array.isArray(b.airports) ? cleanAirports(b.airports as Array<Partial<SavedAirport>>) : undefined;
  // Like the map and airports, left as they were when not sent; an empty value clears them.
  const followed = cleanFollow(b.follow);
  if (followed && !isFollow(followed)) throw new BadRequest('That doesn’t look like a flight number, callsign, registration or hex code.');
  const follow = (s: string | undefined) => b.follow === undefined ? s : followed || undefined;
  const tidePlace = (s: Place | undefined) => b.tidePlace === undefined ? s : b.tidePlace ? cleanPlace(b.tidePlace as Partial<Place>) : undefined;
  const alerts = ALERT_LEVELS.find(l => l === b.alerts);
  const alertSound = typeof b.alertSound === 'boolean' ? b.alertSound : undefined;
  return mutate(env, s => ({ ...s, sky: {
    places, active, radiusNm, map: map ?? s.sky?.map, airports: airports ?? s.sky?.airports, follow: follow(s.sky?.follow), tidePlace: tidePlace(s.sky?.tidePlace),
    alerts: alerts ?? s.sky?.alerts, alertSound: alertSound ?? s.sky?.alertSound,
  } }));
}

function cleanPlace(p: Partial<Place>): Place {
  const lat = Number(p.lat), lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new BadRequest('A place has invalid coordinates.');
  // Two decimal places (~1 km) is all a radar needs, and it keeps exact addresses out of storage.
  return { id: typeof p.id === 'string' && /^[\w-]{1,20}$/.test(p.id) ? p.id : newId(), name: str(p.name, 'Place name', 40), lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

function cleanAirports(raw: Array<Partial<SavedAirport>>): SavedAirport[] {
  // Hubs set up when several airports were allowed still send them all; the first one stays.
  const seen = new Set<string>();
  return raw.slice(0, MAX_AIRPORTS).flatMap(a => {
    const icao = String(a.icao ?? '').toUpperCase();
    const lat = Number(a.lat), lon = Number(a.lon);
    if (!/^[A-Z0-9]{4}$/.test(icao)) throw new BadRequest('An airport has an invalid ICAO code.');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new BadRequest('An airport has invalid coordinates.');
    if (seen.has(icao)) return [];
    seen.add(icao);
    const iata = String(a.iata ?? '').toUpperCase();
    return [{ icao, iata: /^[A-Z0-9]{3}$/.test(iata) ? iata : '', name: str(a.name, 'Airport name', 80), city: str(a.city || a.name, 'Airport city', 60), lat, lon }];
  });
}

// ── Display ─────────────────────────────────────────────────────────────────

async function saveDisplay(env: Env, b: Record<string, unknown>) {
  const clock = CLOCK_STYLES.includes(b.clock as ClockStyle) ? (b.clock as ClockStyle) : null;
  const motion = MOTION_LEVELS.includes(b.motion as MotionLevel) ? (b.motion as MotionLevel) : null;
  if (!clock || !motion) throw new BadRequest('Unknown clock style or motion level.');
  const warmth = WARMTH_LEVELS.find(w => w === b.warmth) ?? 'normal';
  const photoStyle = PHOTO_STYLES.find(p => p === b.photoStyle) ?? 'fill';
  // Onboarding doesn't send night settings: whatever was there before stays.
  const n = (b.night ?? {}) as Record<string, unknown>;
  const night = (s: NightSettings = DEFAULT_NIGHT): NightSettings => b.night === undefined ? s : {
    mode: NIGHT_MODES.find(m => m === n.mode) ?? s.mode,
    from: isClockTime(n.from) ? n.from : s.from,
    to: isClockTime(n.to) ? n.to : s.to,
  };
  const wikiPictures = (s: boolean | undefined) => typeof b.wikiPictures === 'boolean' ? b.wikiPictures : s;
  const stripClock = (s: boolean | undefined) => typeof b.stripClock === 'boolean' ? b.stripClock : s;
  // Like night, left as it was when not sent. Unknown ids are dropped, duplicates collapse.
  if (b.screensOff !== undefined && !Array.isArray(b.screensOff)) throw new BadRequest('screensOff must be a list of screens.');
  const screensOff = (s: ScreenId[] | undefined) => b.screensOff === undefined ? s : SCREEN_IDS.filter(id => (b.screensOff as unknown[]).includes(id));
  if (b.order !== undefined && !Array.isArray(b.order)) throw new BadRequest('order must be a list of screens.');
  const order = (s: ScreenId[] | undefined) => b.order === undefined ? s : screenOrder(b.order as unknown[]);
  // A number from the choices, null for each screen's own pace, or left as it was when not sent.
  if (b.rotateSec !== undefined && b.rotateSec !== null && !ROTATE_CHOICES.includes(b.rotateSec as number)) throw new BadRequest('Unknown screen timing.');
  const rotateSec = (s: number | null | undefined) => (b.rotateSec === undefined ? s : b.rotateSec as number | null) ?? undefined;
  // Seconds per screen, each one of the slider's stops; an empty object goes back to each screen's own pace.
  if (b.screenSec !== undefined && (typeof b.screenSec !== 'object' || b.screenSec === null || Array.isArray(b.screenSec))) throw new BadRequest('screenSec must map screens to seconds.');
  const sent = (b.screenSec ?? {}) as Record<string, unknown>;
  for (const [id, sec] of Object.entries(sent)) {
    if (!SCREEN_IDS.includes(id as ScreenId) || !SCREEN_SEC_STEPS.includes(sec as number)) throw new BadRequest('Unknown screen timing.');
  }
  const screenSec = (s: Partial<Record<ScreenId, number>> | undefined) => b.screenSec === undefined ? s : sent as Partial<Record<ScreenId, number>>;
  return mutate(env, s => ({ ...s, display: { clock, motion, warmth, photoStyle, night: night(s.display?.night), wikiPictures: wikiPictures(s.display?.wikiPictures), screensOff: screensOff(s.display?.screensOff), order: order(s.display?.order), rotateSec: rotateSec(s.display?.rotateSec), screenSec: screenSec(s.display?.screenSec), stripClock: stripClock(s.display?.stripClock) } }));
}
