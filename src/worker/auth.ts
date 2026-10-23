import type { Env } from './env';

// A display is paired once by visiting /pair#<DISPLAY_TOKEN>. The page posts the token to
// /api/pair, which sets a long-lived cookie holding an HMAC derived from the token. Rotating
// DISPLAY_TOKEN therefore unpairs every display.

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

export async function handlePair(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  if (!env.DISPLAY_TOKEN || typeof body.token !== 'string' || !safeEqual(body.token, env.DISPLAY_TOKEN)) {
    return new Response('Invalid token', { status: 401 });
  }
  const value = await cookieValue(env.DISPLAY_TOKEN);
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax` },
  });
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
