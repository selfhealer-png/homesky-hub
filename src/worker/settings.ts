import { EMPTY_SETTINGS, type Settings } from '../shared/settings';
import type { Env } from './env';

// Settings live in KV as plain JSON. Secrets live beside them as one AES-GCM blob whose key is
// derived (HKDF) from ADMIN_PASSWORD. HKDF rather than a slow password hash is deliberate: the
// setup wizard generates ADMIN_PASSWORD as a 192-bit random string, and the Workers free plan
// allows only ~10 ms of CPU per request. Changing ADMIN_PASSWORD makes the stored secrets
// unreadable, so they have to be entered again.

const SETTINGS_KEY = 'settings:v1';
const SECRETS_KEY = 'secrets:v1';

export class SettingsUnavailable extends Error {}

function kv(env: Env): KVNamespace {
  if (!env.HUB_KV) throw new SettingsUnavailable('HUB_KV is not bound. Run `npm run setup` or add a KV namespace to wrangler.toml.');
  return env.HUB_KV;
}

let settingsCache: { value: Settings; at: number } | null = null;

export async function loadSettings(env: Env): Promise<Settings> {
  if (!env.HUB_KV) return EMPTY_SETTINGS;
  if (settingsCache && Date.now() - settingsCache.at < 30_000) return settingsCache.value;
  const value = ((await env.HUB_KV.get(SETTINGS_KEY, 'json')) as Settings | null) ?? EMPTY_SETTINGS;
  settingsCache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(env: Env, settings: Settings): Promise<void> {
  await kv(env).put(SETTINGS_KEY, JSON.stringify(settings));
  settingsCache = { value: settings, at: Date.now() };
}

async function secretsKey(env: Env): Promise<CryptoKey> {
  if (!env.ADMIN_PASSWORD) throw new SettingsUnavailable('ADMIN_PASSWORD is not set.');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_PASSWORD), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('homesky-hub'), info: new TextEncoder().encode('settings-secrets-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function loadSecrets(env: Env): Promise<Record<string, string>> {
  if (!env.HUB_KV || !env.ADMIN_PASSWORD) return {};
  const stored = (await env.HUB_KV.get(SECRETS_KEY, 'json')) as { iv: string; data: string } | null;
  if (!stored) return {};
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(stored.iv) }, await secretsKey(env), unb64(stored.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // Wrong key: ADMIN_PASSWORD changed since these were saved.
    return {};
  }
}

/** Applies changes; a null value deletes that secret. */
export async function updateSecrets(env: Env, changes: Record<string, string | null>): Promise<void> {
  const secrets = await loadSecrets(env);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete secrets[k];
    else secrets[k] = v;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretsKey(env), new TextEncoder().encode(JSON.stringify(secrets)));
  await kv(env).put(SECRETS_KEY, JSON.stringify({ iv: b64(iv), data: b64(new Uint8Array(data)) }));
}
