import type { WikiResponse } from '../shared/types';
import { cached } from './cache';
import { json, USER_AGENT, type Env } from './env';

// Wikipedia's featured article of the day, from the Wikimedia feed API (free, no key). A new
// article is chosen each day at midnight UTC; the text is CC BY-SA, credited on the screen.

interface Feed {
  tfa?: {
    titles?: { normalized?: string };
    description?: string;
    extract?: string;
    thumbnail?: { source: string; width: number; height: number };
    originalimage?: { source: string; width: number; height: number };
    content_urls?: { desktop?: { page?: string } };
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '/');

// Sharp on a tablet without being heavy. It must be one of Wikimedia's standard thumbnail
// widths (500, 960, …): others are refused.
const IMAGE_WIDTH = 960;

/** Wikimedia thumbnails are resized by changing the "320px-" in their URL; smaller originals
 *  are used as they are. */
function picture(t: NonNullable<Feed['tfa']>): WikiResponse['image'] {
  const thumb = t.thumbnail, full = t.originalimage;
  if (!thumb || !full) return undefined;
  const url = full.width > IMAGE_WIDTH ? thumb.source.replace(/\/\d+px-([^/]+)$/, `/${IMAGE_WIDTH}px-$1`) : full.source;
  return { url, width: full.width, height: full.height };
}

async function fetchArticle(): Promise<WikiResponse | null> {
  const now = new Date();
  // Just after midnight UTC the new day's feed can lag behind; fall back to yesterday's.
  for (const date of [now, new Date(now.getTime() - 86_400_000)]) {
    const res = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${day(date)}`, {
      headers: { 'user-agent': `${USER_AGENT} (open-source home display)`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const t = ((await res.json()) as Feed).tfa;
    if (!t?.titles?.normalized || !t.extract) continue;
    return {
      date: date.toISOString().slice(0, 10),
      title: t.titles.normalized,
      description: t.description,
      extract: t.extract,
      url: t.content_urls?.desktop?.page,
      image: picture(t),
    };
  }
  return null;
}

export async function handleWiki(env: Env): Promise<Response> {
  try {
    const article = await cached(env, `wiki:v2:${new Date().toISOString().slice(0, 10)}`, a => (a ? 3 * 3600 : 600), fetchArticle);
    return article ? json(article) : json({ error: 'No featured article today' }, { status: 404 });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 502 });
  }
}
