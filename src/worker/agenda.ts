import type { AgendaResponse } from '../shared/types';
import { secretKey, type Connection } from '../shared/settings';
import { cached } from './cache';
import { demoFeed } from './demo';
import { readDevice } from './device';
import { json, type Env } from './env';
import { ProviderError, type ProviderResult } from './providers/common';
import { readFeed } from './providers/feed';
import { readGoogle } from './providers/google';
import { readIcs } from './providers/ics';
import { loadSecrets, loadSettings } from './settings';

const CACHE_SECONDS = 300;

/** Reads one connection, uncached. Used by the agenda and by the "Test" buttons in /setup. */
export async function readConnection(env: Env, conn: Connection, secrets: Record<string, string>): Promise<ProviderResult> {
  switch (conn.kind) {
    case 'ics': {
      const url = secrets[secretKey.icsUrl(conn.id)];
      if (!url) throw new ProviderError('The calendar link is missing. Was ADMIN_PASSWORD changed? Paste the link again.');
      return readIcs(conn, url);
    }
    case 'feed':
      return readFeed(conn.id, conn.url, secrets[secretKey.feedToken(conn.id)]);
    case 'google': {
      const clientSecret = secrets[secretKey.googleClientSecret];
      const refreshToken = secrets[secretKey.googleRefreshToken];
      // The iOS app's own client has no secret (it signs in with PKCE).
      if ((!clientSecret && !conn.native) || !refreshToken) throw new ProviderError('Google is not connected.');
      return readGoogle(conn, { clientId: conn.clientId, clientSecret: clientSecret ?? '', refreshToken });
    }
  }
}

// A cheap fingerprint of a connection's settings, so editing one doesn't wait out the cache.
function fingerprint(conn: Connection): string {
  let h = 2166136261;
  for (const ch of JSON.stringify(conn)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

export async function handleAgenda(env: Env): Promise<Response> {
  const settings = await loadSettings(env);
  // A Google client that hasn't been signed in to yet isn't a source yet, so it isn't an error either.
  const connections = settings.connections.filter(c => c.enabled && (c.kind !== 'google' || c.account));
  const tasks: Array<Promise<ProviderResult>> = [];
  const names: string[] = [];

  // A feed set as a deployment variable still works, alongside anything added in /setup.
  if (env.AGENDA_FEED_URL === 'demo') {
    const demo = demoFeed();
    tasks.push(Promise.resolve({ sources: demo.sources, events: demo.events, tasks: demo.tasks }));
    names.push('Demo');
  } else if (env.AGENDA_FEED_URL) {
    tasks.push(cached(env, 'agenda:envfeed', CACHE_SECONDS, () => readFeed('env', env.AGENDA_FEED_URL!, env.AGENDA_FEED_TOKEN)));
    names.push('Agenda feed');
  }

  // The iPad's own calendars and reminders (iOS app only), read on the device: not cached.
  if (env.DEVICE && (settings.device?.calendars.some(c => c.enabled) || settings.device?.reminderLists.some(l => l.enabled))) {
    tasks.push(readDevice(env, settings).then(r => r ?? { sources: [], events: [], tasks: [] }));
    names.push('This iPad');
  }

  if (!tasks.length && !connections.length) return json({ configured: false } satisfies AgendaResponse);

  const secrets = connections.length ? await loadSecrets(env) : {};
  for (const conn of connections) {
    tasks.push(cached(env, `agenda:${conn.id}:${fingerprint(conn)}`, CACHE_SECONDS, () => readConnection(env, conn, secrets)));
    names.push(conn.kind === 'google' ? 'Google' : conn.name);
  }

  const results = await Promise.allSettled(tasks);
  const merged: ProviderResult = { sources: [], events: [], tasks: [] };
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      merged.sources.push(...r.value.sources);
      merged.events.push(...r.value.events);
      merged.tasks.push(...r.value.tasks);
    } else {
      errors.push(`${names[i]}: ${r.reason instanceof ProviderError ? r.reason.message : 'could not be read'}`);
    }
  });

  return json({
    configured: true,
    version: 1,
    generatedAt: new Date().toISOString(),
    ...merged,
    errors,
  } satisfies AgendaResponse);
}
