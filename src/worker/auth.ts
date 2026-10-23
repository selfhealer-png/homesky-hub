import { adminSessionCookie, checkAdminPassword } from './adminAuth';
import { json, type Env } from './env';
import { loadSettings } from './settings';

// A display is paired once, either by opening /pair#<DISPLAY_TOKEN> or by typing the admin
// password on the display's own welcome screen. Pairing sets a long-lived cookie holding an
// HMAC derived from DISPLAY_TOKEN, so rotating DISPLAY_TOKEN unpairs every display.
//
// The password route matters on iPhone and iPad: Safari and a Home Screen web app keep separate
// cookies, so a pairing done in Safari never reaches the app added to the Home Screen.

const COOKIE = 'hub_display';
const MAX_AGE = 400 * 24 * 3600; // the longest Safari keeps a cookie

async function cookieValue(token: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('display-v1'));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]!);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isDisplayAuthorized(request: Request, env: Env): Promise<boolean> {
  if (env.ALLOW_OPEN === '1') return true;
  // An unset secret must never authorize anything.
  if (!env.DISPLAY_TOKEN) return false;
  const match = (request.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return !!match && safeEqual(match[1], await cookieValue(env.DISPLAY_TOKEN));
}

/** True when nothing has been set up in /setup yet: the display then greets you rather than asking. */
async function isFreshHub(env: Env): Promise<boolean> {
  const s = await loadSettings(env);
  return !s.connections.length && !s.sky && !s.display && !env.AGENDA_FEED_URL;
}

/** Public: lets an unpaired display choose between a welcome and a plain pairing prompt. */
export async function handleWelcome(env: Env): Promise<Response> {
  return json({ fresh: await isFreshHub(env) });
}

export async function handlePair(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { token?: string; password?: string };
  if (!env.DISPLAY_TOKEN) return json({ error: 'DISPLAY_TOKEN is not set on this hub. Run `npm run setup`.' }, { status: 503 });
  const headers = new Headers();
  if (typeof body.password === 'string') {
    const refused = await checkAdminPassword(request, env, body.password);
    if (refused) return refused;
    // Whoever knows the admin password is setting this device up: sign them in to setup too.
    headers.append('set-cookie', await adminSessionCookie(env));
  } else if (typeof body.token !== 'string' || !safeEqual(body.token, env.DISPLAY_TOKEN)) {
    return json({ error: 'That pairing link is not valid.' }, { status: 401 });
  }
  headers.append('set-cookie', `${COOKIE}=${await cookieValue(env.DISPLAY_TOKEN)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
  return json({ ok: true, fresh: await isFreshHub(env) }, { headers });
}

export const PAIR_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair display</title>
<style>body{font:18px system-ui;background:#0b1020;color:#e6ebff;display:grid;place-items:center;height:100vh;margin:0}</style>
</head><body><p id="msg">Pairing…</p><script>
const token = decodeURIComponent(location.hash.slice(1));
history.replaceState(null, '', '/pair');
fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  .then(r => { if (r.ok) location.replace('/'); else document.getElementById('msg').textContent = 'That pairing link is not valid.'; })
  .catch(() => { document.getElementById('msg').textContent = 'Could not reach the hub.'; });
</script></body></html>`;
