import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';

// The web app lives in src/web and builds to dist/, which the Worker serves as static assets.
// Two pages: the display (index.html) and the admin setup page (setup.html, served at /setup).
// In dev, run `npm run dev:worker` alongside `npm run dev` so /api calls reach the Worker.
//
// `--mode app` builds the iOS app's web content instead (dist-app/): the Worker runs inside the
// page (src/web/app/boot.ts), so no Worker is needed, and in dev other origins are fetched
// through /__proxy here because browsers enforce CORS (the app itself uses native HTTP).

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Adds the in-page Worker to both pages, ahead of their own scripts. */
function appBoot(): Plugin {
  return {
    name: 'homesky-app-boot',
    transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/app/boot.ts' }, injectTo: 'head-prepend' }],
  };
}

const DROP_REQUEST = new Set(['host', 'origin', 'referer', 'cookie', 'connection', 'content-length', 'accept-encoding', 'x-hub-proxy-url']);
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

/**
 * Development only, so the in-page Worker can reach sources that send no CORS headers (ADS-B
 * feeds, most iCal hosts). Fetches the URL named in X-Hub-Proxy-URL and passes the answer back.
 * It's an open relay for whoever can reach the dev server, so it is never part of a build.
 */
function devProxy(): Plugin {
  const handle: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url?.startsWith('/__proxy')) return next();
    void (async () => {
      const target = String(req.headers['x-hub-proxy-url'] ?? '');
      if (!/^https?:\/\//.test(target)) { res.statusCode = 400; res.end('X-Hub-Proxy-URL must be an http(s) URL'); return; }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQUEST.has(k) && typeof v === 'string') headers[k] = v;
      headers['user-agent'] = 'homesky-hub/0.1 (app, dev proxy)';
      try {
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        });
        res.statusCode = upstream.status;
        upstream.headers.forEach((v, k) => { if (!DROP_RESPONSE.has(k)) res.setHeader(k, v); });
        res.setHeader('cache-control', 'no-store');
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.statusCode = 502;
        res.end(`Proxy could not reach ${new URL(target).host}: ${(err as Error).message}`);
      }
    })();
  };
  return {
    name: 'homesky-dev-proxy',
    configureServer: server => { server.middlewares.use(handle); },
    configurePreviewServer: server => { server.middlewares.use(handle); },
  };
}

export default defineConfig(({ mode }) => {
  const app = mode === 'app';
  return {
    root: 'src/web',
    // .env.app (git-ignored) sits at the project root, e.g. VITE_AGENDA_FEED_URL=demo for the sample agenda.
    envDir: src('.'),
    publicDir: 'public',
    plugins: app ? [appBoot(), devProxy()] : [],
    resolve: app ? { alias: { 'cloudflare:workers': src('./src/web/app/cloudflareWorkers.ts') } } : {},
    build: {
      outDir: app ? '../../dist-app' : '../../dist',
      emptyOutDir: true,
      target: 'es2020',
      rollupOptions: {
        input: {
          main: src('./src/web/index.html'),
          setup: src('./src/web/setup.html'),
        },
      },
    },
    server: {
      host: true,
      proxy: app ? {} : { '/api': 'http://localhost:8787', '/pair': 'http://localhost:8787' },
    },
  };
});
