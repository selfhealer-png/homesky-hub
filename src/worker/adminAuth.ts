import { json, type Env } from './env';

// Admin sessions for /setup: a cookie holding "<expiry>.<HMAC(expiry)>", keyed off
// ADMIN_PASSWORD, so changing the password signs everyone out. SameSite=Strict, and every
// state-changing admin request must also carry the X-Hub-Admin header, which a cross-site
// form cannot send.

const COOKIE = 'hub_admin';
// As long as a display stays paired: Safari keeps a cookie at most 400 days.
const SESSION_HOURS = 400 * 24;
const MAX_FAILURES = 10; // per IP per 15 minutes

export async function hmac(env: Env, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`admin-session-v1:${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]!);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false; // an unset secret never authorizes
  const m = (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)hub_admin=(\d+)\.([\w-]+)/);
  if (!m || Number(m[1]) < Date.now()) return false;
  return safeEqual(m[2], await hmac(env, m[1]));
}

/** True for safe methods, or when the request carries the custom admin header. */
export function passesCsrfCheck(request: Request): boolean {
  return request.method === 'GET' || request.headers.get('x-hub-admin') === '1';
}

/**
 * Checks an admin password, counting failures per IP. Returns an error response, or null when
 * the password is right. Shared by the setup sign-in and by pairing a display with the password.
 */
export async function checkAdminPassword(request: Request, env: Env, password: unknown): Promise<Response | null> {
  if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD is not set on this hub. Run `npm run setup`.' }, { status: 503 });
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const failKey = `login-fail:${ip}`;
  const failures = Number((await env.HUB_KV?.get(failKey)) ?? 0);
  if (failures >= MAX_FAILURES) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
  if (typeof password !== 'string' || !safeEqual(password, env.ADMIN_PASSWORD)) {
    await env.HUB_KV?.put(failKey, String(failures + 1), { expirationTtl: 15 * 60 });
    return json({ error: 'That password is not right.' }, { status: 401 });
  }
  return null;
}

export async function adminSessionCookie(env: Env): Promise<string> {
  const expiry = String(Date.now() + SESSION_HOURS * 3600_000);
  return `${COOKIE}=${expiry}.${await hmac(env, expiry)}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`;
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const refused = await checkAdminPassword(request, env, body.password);
  if (refused) return refused;
  return json({ ok: true }, { headers: { 'set-cookie': await adminSessionCookie(env) } });
}

export function handleLogout(): Response {
  return json({ ok: true }, { headers: { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } });
}
