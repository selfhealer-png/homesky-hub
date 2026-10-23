import { secretKey, type GoogleConnection, type PhotoInfo, type PickStatus } from '../shared/settings';
import { json, type Env } from './env';
import { ProviderError } from './providers/common';
import { accessToken, PHOTOS_SCOPE } from './providers/google';
import { loadSecrets, loadSettings } from './settings';

// The photo frame's library. Since March 2025 Google only lets apps read photos the person
// picks in the Google Photos Picker, and the picked items' URLs expire after an hour, so
// picked photos are copied into R2 at display size (plus a small thumbnail for /setup).
//
// Importing is done in small batches, one per poll from /setup, to stay inside the Worker
// subrequest limit: each photo is two downloads (display size and thumbnail).

const PICKER = 'https://photospicker.googleapis.com/v1';
const DISPLAY_SIZE = { w: 2048, h: 1536 };
const BATCH = 8;

interface Pending { gid: string; baseUrl: string; taken: string | null; width: number; height: number }
interface ImportState { collection: string; pending: Pending[]; total: number; imported: number; skipped: number }

class PhotosUnavailable extends ProviderError {}

function bucket(env: Env): R2Bucket {
  if (!env.PHOTOS) throw new PhotosUnavailable('No R2 bucket is bound for photos. Run `npm run setup` and choose to create the photo bucket.');
  return env.PHOTOS;
}

async function photosToken(env: Env): Promise<string> {
  const settings = await loadSettings(env);
  const g = settings.connections.find((c): c is GoogleConnection => c.kind === 'google');
  const secrets = await loadSecrets(env);
  if (!g?.account || !secrets[secretKey.googleRefreshToken]) throw new PhotosUnavailable('Connect Google first (in Calendars and tasks).');
  if (g.scopes && !g.scopes.includes(PHOTOS_SCOPE)) throw new PhotosUnavailable('Google is connected without photo access. Press “Reconnect Google” to allow it.');
  return accessToken(g.clientId, secrets[secretKey.googleClientSecret], secrets[secretKey.googleRefreshToken]);
}

async function picker<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PICKER}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 403) throw new PhotosUnavailable('Google refused photo access. Is the Photos Picker API enabled in your Google Cloud project?');
  if (!res.ok) throw new ProviderError(`Google Photos answered ${res.status}.`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

// Stable, URL-safe ids: picking the same photo again overwrites rather than duplicates.
async function photoId(gid: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(gid)));
  return [...digest.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const seconds = (duration: string | undefined, fallback: number) => {
  const n = parseFloat(duration ?? '');
  return Number.isFinite(n) ? n : fallback;
};

// ── picking ─────────────────────────────────────────────────────────────────

export async function startPicking(env: Env, collection: string): Promise<{ sessionId: string; pickerUri: string }> {
  bucket(env);
  const token = await photosToken(env);
  const session = await picker<{ id: string; pickerUri: string }>(token, '/sessions', { method: 'POST', body: JSON.stringify({ pickingConfig: { maxItemCount: '500' } }) });
  await env.HUB_KV!.put(`photos:pick:${session.id}`, JSON.stringify({ collection, pending: [], total: -1, imported: 0, skipped: 0 } satisfies ImportState), { expirationTtl: 2 * 3600 });
  return { sessionId: session.id, pickerUri: session.pickerUri };
}

export async function pollPicking(env: Env, sessionId: string): Promise<PickStatus> {
  if (!/^[\w-]{1,200}$/.test(sessionId)) throw new ProviderError('Unknown picking session.');
  const key = `photos:pick:${sessionId}`;
  const st = (await env.HUB_KV!.get(key, 'json')) as ImportState | null;
  if (!st) return { state: 'expired' };
  const token = await photosToken(env);

  if (st.total < 0) {
    const session = await picker<{ mediaItemsSet?: boolean; pollingConfig?: { pollInterval?: string; timeoutIn?: string } }>(token, `/sessions/${sessionId}`);
    if (!session.mediaItemsSet) {
      if (session.pollingConfig?.timeoutIn && seconds(session.pollingConfig.timeoutIn, 1) <= 0) return { state: 'expired' };
      return { state: 'waiting', pollMs: Math.max(2000, seconds(session.pollingConfig?.pollInterval, 3) * 1000) };
    }
    // Picked: list everything once, then import it batch by batch.
    let pageToken = '';
    do {
      const page = await picker<{ mediaItems?: Array<{ id: string; createTime?: string; type?: string; mediaFile: { baseUrl: string; mediaFileMetadata?: { width?: number; height?: number } } }>; nextPageToken?: string }>(
        token, `/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const m of page.mediaItems ?? []) {
        if (m.type === 'VIDEO') { st.skipped++; continue; }
        st.pending.push({ gid: m.id, baseUrl: m.mediaFile.baseUrl, taken: m.createTime ?? null, width: m.mediaFile.mediaFileMetadata?.width ?? 0, height: m.mediaFile.mediaFileMetadata?.height ?? 0 });
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    st.total = st.pending.length;
  }

  const r2 = bucket(env);
  for (const item of st.pending.splice(0, BATCH)) {
    try {
      const [full, thumb] = await Promise.all([
        fetch(`${item.baseUrl}=w${DISPLAY_SIZE.w}-h${DISPLAY_SIZE.h}`, { headers: { authorization: `Bearer ${token}` } }),
        fetch(`${item.baseUrl}=w360-h360-c`, { headers: { authorization: `Bearer ${token}` } }),
      ]);
      if (!full.ok || !thumb.ok) throw new Error();
      // The size Google returns: the original scaled to fit within DISPLAY_SIZE.
      const scale = item.width && item.height ? Math.min(1, DISPLAY_SIZE.w / item.width, DISPLAY_SIZE.h / item.height) : 1;
      const id = await photoId(item.gid);
      const meta = {
        width: String(Math.round(item.width * scale) || 0),
        height: String(Math.round(item.height * scale) || 0),
        taken: item.taken ?? '',
        collection: st.collection,
      };
      await Promise.all([
        r2.put(`photos/${id}`, await full.arrayBuffer(), { httpMetadata: { contentType: full.headers.get('content-type') ?? 'image/jpeg' }, customMetadata: meta }),
        r2.put(`thumbs/${id}`, await thumb.arrayBuffer(), { httpMetadata: { contentType: thumb.headers.get('content-type') ?? 'image/jpeg' } }),
      ]);
      st.imported++;
    } catch {
      st.skipped++;
    }
  }

  if (st.pending.length) {
    await env.HUB_KV!.put(key, JSON.stringify(st), { expirationTtl: 2 * 3600 });
    return { state: 'importing', imported: st.imported, total: st.total };
  }
  await env.HUB_KV!.delete(key);
  await picker(token, `/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
  libraryCache = null;
  return { state: 'done', imported: st.imported, skipped: st.skipped };
}

// ── library ─────────────────────────────────────────────────────────────────

let libraryCache: { photos: PhotoInfo[]; at: number } | null = null;

// Captions live in KV rather than in R2 metadata: R2 can't change an object's metadata without
// rewriting the whole photo.
const CAPTIONS_KEY = 'photos:captions:v1';
const loadCaptions = async (env: Env) => ((await env.HUB_KV?.get(CAPTIONS_KEY, 'json')) as Record<string, string> | null) ?? {};

export async function listPhotos(env: Env): Promise<PhotoInfo[]> {
  if (!env.PHOTOS) return [];
  if (libraryCache && Date.now() - libraryCache.at < 5 * 60_000) return libraryCache.photos;
  const captions = await loadCaptions(env);
  const photos: PhotoInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ prefix: 'photos/', cursor, include: ['customMetadata'] });
    for (const o of page.objects) {
      const m = o.customMetadata ?? {};
      const id = o.key.slice('photos/'.length);
      photos.push({ id, width: Number(m.width) || 0, height: Number(m.height) || 0, taken: m.taken || null, collection: m.collection || 'Photos', caption: captions[id] ?? null });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  libraryCache = { photos, at: Date.now() };
  return photos;
}

export async function deletePhotos(env: Env, which: { ids?: unknown; collection?: unknown }): Promise<PhotoInfo[]> {
  const all = await listPhotos(env);
  const ids = Array.isArray(which.ids) ? new Set(which.ids.filter((x): x is string => typeof x === 'string')) : null;
  const doomed = all.filter(p => (ids ? ids.has(p.id) : typeof which.collection === 'string' && p.collection === which.collection));
  const keys = doomed.flatMap(p => [`photos/${p.id}`, `thumbs/${p.id}`]);
  for (let i = 0; i < keys.length; i += 1000) await bucket(env).delete(keys.slice(i, i + 1000));
  // Forget the captions of deleted photos too.
  if (env.HUB_KV && doomed.length) {
    const captions = await loadCaptions(env);
    doomed.forEach(p => delete captions[p.id]);
    await env.HUB_KV.put(CAPTIONS_KEY, JSON.stringify(captions));
  }
  libraryCache = null;
  return listPhotos(env);
}

/** Sets (or clears, with an empty caption) the caption of some photos, or of a whole collection. */
export async function setCaptions(env: Env, b: { ids?: unknown; collection?: unknown; caption?: unknown }): Promise<PhotoInfo[]> {
  if (!env.HUB_KV) throw new PhotosUnavailable('Settings storage (KV) is needed for captions.');
  const caption = typeof b.caption === 'string' ? b.caption.trim().slice(0, 60) : '';
  const all = await listPhotos(env);
  const ids = Array.isArray(b.ids) ? new Set(b.ids.filter((x): x is string => typeof x === 'string')) : null;
  const targets = all.filter(p => (ids ? ids.has(p.id) : typeof b.collection === 'string' && p.collection === b.collection));
  const captions = await loadCaptions(env);
  for (const p of targets) {
    if (caption) captions[p.id] = caption;
    else delete captions[p.id];
  }
  await env.HUB_KV.put(CAPTIONS_KEY, JSON.stringify(captions));
  libraryCache = null;
  return listPhotos(env);
}

/** Serves a stored photo or thumbnail. Ids are content-derived, so caching forever is safe. */
export async function servePhoto(env: Env, kind: 'photos' | 'thumbs', id: string, request: Request): Promise<Response> {
  if (!env.PHOTOS || !/^[0-9a-f]{20}$/.test(id)) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(`${kind}/${id}`, { onlyIf: request.headers });
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'cache-control': 'private, max-age=31536000, immutable', etag: obj.httpEtag });
  obj.writeHttpMetadata(headers);
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

export async function handleDisplayPhotos(env: Env, url: URL, request: Request): Promise<Response> {
  const m = url.pathname.match(/^\/api\/photos\/([0-9a-f]{20})$/);
  if (m) return servePhoto(env, 'photos', m[1], request);
  return json({ configured: !!env.PHOTOS, photos: await listPhotos(env) });
}
