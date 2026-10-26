import { handleAdmin } from './admin';
import { handleAgenda } from './agenda';
import { handleAircraft } from './aircraft';
import { handleAirportBoard } from './airports';
import { handlePair, handleWelcome, isDisplayAuthorized, PAIR_PAGE } from './auth';
import { json, type Env } from './env';
import { handleLogo } from './logos';
import { handleOverhead } from './overhead';
import { handleDisplayPhotos } from './photos';
import { hubConfig } from './sky';
import { handleTonight } from './tonight';
import { handleWeather } from './weather';
import { handleWiki } from './wiki';

// The shared fetcher for live aircraft (a Durable Object; see skyFetcher.ts).
export { SkyFetcher } from './skyFetcher';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/pair') return new Response(PAIR_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (pathname === '/api/pair' && request.method === 'POST') return handlePair(request, env);
    if (pathname === '/api/welcome') return handleWelcome(env);
    // Setup is used from a phone or laptop, not the paired display, so it has its own login.
    if (pathname.startsWith('/api/admin/') || pathname === '/setup/google/callback') return handleAdmin(request, env, url);

    if (pathname.startsWith('/api/')) {
      if (!(await isDisplayAuthorized(request, env))) return json({ error: 'Display not paired' }, { status: 401 });

      if (pathname === '/api/photos' || pathname.startsWith('/api/photos/')) return handleDisplayPhotos(env, url, request);
      if (pathname.startsWith('/api/logo/')) return handleLogo(pathname);

      switch (pathname) {
        case '/api/config': return json(await hubConfig(env, request));
        case '/api/aircraft': return handleAircraft(env, url, request);
        case '/api/overhead': return handleOverhead(url, env, request);
        case '/api/airport': return handleAirportBoard(env, url);
        case '/api/weather': return handleWeather(env, url, request);
        case '/api/agenda': return handleAgenda(env);
        case '/api/wiki': return handleWiki(env);
        case '/api/tonight': return handleTonight(env, url, request);
        default: return json({ error: 'Not found' }, { status: 404 });
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
