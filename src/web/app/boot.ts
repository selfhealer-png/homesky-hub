import { adminSessionCookie } from '../../worker/adminAuth';
import type { Env } from '../../worker/env';
import worker from '../../worker/index';
import { SkyFetcher } from '../../worker/skyFetcher';
import { LocalBucket, LocalKV, LocalNamespace } from './bindings';
import { nativeDevice, sampleDevice } from './device';
import { idb } from './idb';
import { prefsStore } from './prefsStore';

// App mode (`npm run dev:app`, `npm run build:app`): the Worker runs inside this page instead of
// on Cloudflare. Loaded before the display and setup scripts (vite.config.ts adds it to both
// pages), it replaces window.fetch so that:
//   • same-origin /api/… requests are answered by the Worker's own fetch handler, in-process;
//   • everything else goes out as normal. In the iOS app Capacitor's native HTTP has already
//     patched fetch, so there's no CORS. In a desktop or iPad browser during development, other
//     origins go through the dev server's /__proxy instead (see vite.config.ts).
//
// There's no pairing and no admin password to type: the display is allowed in (ALLOW_OPEN) and
// every request carries an admin session made here. The admin secret is random per install and
// only exists so settings.ts can keep encrypting stored connection secrets as it does today.
// In the iOS app the secret is kept in the Keychain.

declare global {
  interface Window { Capacitor?: { isNativePlatform?: () => boolean } }
}

const SECRETS_KEY = 'app:secrets';
const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const realFetch = window.fetch.bind(window);

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}

/**
 * The per-install secret: in the iOS app it lives in the Keychain, apart from the data it
 * protects; in a browser (development) there's nowhere better than IndexedDB.
 */
async function installSecrets(): Promise<{ admin: string }> {
  if (isNative()) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const found = await SecureStorage.getItem(SECRETS_KEY).catch(() => null);
    if (found) return { admin: found };
    const admin = randomSecret();
    await SecureStorage.setItem(SECRETS_KEY, admin);
    return { admin };
  }
  const found = await idb.get<{ admin: string }>('kv', SECRETS_KEY);
  if (found) return found;
  const fresh = { admin: randomSecret() };
  await idb.put('kv', SECRETS_KEY, fresh);
  return fresh;
}

async function makeEnv(): Promise<{ env: Env; cookie: string }> {
  const secrets = await installSecrets();
  const env = {
    HOME_LAT: '',
    HOME_LON: '',
    TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ALLOW_OPEN: '1',
    AIRCRAFT_SOURCES: 'adsb.lol',
    ADMIN_PASSWORD: secrets.admin,
    AGENDA_FEED_URL: import.meta.env.VITE_AGENDA_FEED_URL || undefined,
    HUB_KV: new LocalKV(isNative() ? prefsStore((await import('@capacitor/preferences')).Preferences) : idb),
    // Photos copied from Google Photos: at most ~300 MB on the iPad, oldest dropped first.
    PHOTOS: new LocalBucket(idb, 300 * 1024 * 1024),
    DEVICE: isNative() ? nativeDevice() : import.meta.env.VITE_FAKE_DEVICE === '1' ? sampleDevice() : undefined,
    GOOGLE_IOS_CLIENT_ID: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID || undefined,
  } as unknown as Env;
  env.SKY = new LocalNamespace(idb, state => new SkyFetcher(state as never, env)) as unknown as Env['SKY'];
  const cookie = (await adminSessionCookie(env)).split(';')[0];
  return { env, cookie };
}

let ready: ReturnType<typeof makeEnv> | null = null;

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), location.href);
}

/** Answers an /api/… request with the in-page Worker. */
async function local(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { env, cookie } = await (ready ??= makeEnv());
  const request = new Request(input, init);
  // `cookie` is a forbidden header on a Request, but a standalone Headers object accepts it.
  const headers = new Headers(request.headers);
  headers.set('cookie', cookie);
  Object.defineProperty(request, 'headers', { value: headers });
  try {
    return await worker.fetch(request, env);
  } catch (err) {
    console.error('[app] Worker error', request.url, err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

/** Development only: sends another origin's request through the dev server, which has no CORS. */
async function viaDevProxy(url: URL, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set('x-hub-proxy-url', url.href);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  // One address for every target, so the browser must never answer from its cache.
  return realFetch('/__proxy', { method: request.method, headers, body, cache: 'no-store', signal: init?.signal ?? request.signal });
}

// In the app, a link meant for a new tab (Google's photo picker, help pages) opens in the system
// browser sheet, which comes back to the app when closed, instead of replacing the display.
if (isNative()) {
  document.addEventListener('click', e => {
    const a = (e.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
    if (!a?.href || !/^https?:/.test(a.href)) return;
    e.preventDefault();
    void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: a.href }));
  }, true);
}

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return local(input, init);
  if (url.origin !== location.origin && !isNative() && /^https?:$/.test(url.protocol)) return viaDevProxy(url, input, init);
  return realFetch(input, init);
};
