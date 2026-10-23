import type { AgendaFeed } from '../../shared/types';
import { USER_AGENT } from '../env';
import { fetchUserUrl, ProviderError, type ProviderResult } from './common';

// Any endpoint implementing docs/feed-contract.md. Source ids are prefixed with the
// connection id so two feeds (or a feed and a calendar) can't collide.
export async function readFeed(connId: string, url: string, token: string | undefined): Promise<ProviderResult> {
  const u = new URL(url);
  if (!u.searchParams.has('days')) u.searchParams.set('days', '21');
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': USER_AGENT };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetchUserUrl(u.toString(), { headers });
  const feed = (await res.json().catch(() => null)) as AgendaFeed | null;
  if (!feed || feed.version !== 1 || !Array.isArray(feed.events)) throw new ProviderError('The feed did not return agenda feed v1 JSON (see docs/feed-contract.md).');

  const id = (s: string) => `${connId}/${s}`;
  return {
    sources: (feed.sources ?? []).map(s => ({ ...s, id: id(s.id) })),
    events: feed.events.map(e => ({ ...e, id: id(e.id), source: id(e.source) })),
    tasks: (feed.tasks ?? []).filter(t => !t.done).map(t => ({ ...t, id: id(t.id), source: id(t.source) })),
  };
}
