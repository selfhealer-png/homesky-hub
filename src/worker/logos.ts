import { json } from './env';

// Airline logos for the overhead board, by IATA code, from Travelpayouts' free logo service
// (pics.avs.io). Fetched here rather than by the display because the service answers a code it
// doesn't know with a generic plane picture; that, and any miss, comes back as a plain 404, so
// the board shows no logo rather than a wrong one.

const IATA = /^[A-Z0-9]{2}$/;
/** The generic plane is about 1.2 KB; real logos are 4 KB and up. */
const PLACEHOLDER_MAX_BYTES = 2000;
const DAY = 86_400;

const none = () => json({ error: 'No logo' }, { status: 404, headers: { 'cache-control': `public, max-age=${DAY}` } });

export async function handleLogo(pathname: string): Promise<Response> {
  const code = pathname.slice('/api/logo/'.length).toUpperCase();
  if (!IATA.test(code)) return none();
  const res = await fetch(`https://pics.avs.io/240/80/${code}.png`, { cf: { cacheEverything: true, cacheTtl: 30 * DAY } }).catch(() => null);
  if (!res?.ok || !res.headers.get('content-type')?.startsWith('image/')) return none();
  const body = await res.arrayBuffer();
  if (body.byteLength < PLACEHOLDER_MAX_BYTES) return none();
  return new Response(body, { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${7 * DAY}` } });
}
