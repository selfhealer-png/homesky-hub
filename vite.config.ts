import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The web app lives in src/web and builds to dist/, which the Worker serves as static assets.
// Two pages: the display (index.html) and the admin setup page (setup.html, served at /setup).
// In dev, run `npm run dev:worker` alongside `npm run dev` so /api calls reach the Worker.
export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/web/index.html', import.meta.url)),
        setup: fileURLToPath(new URL('./src/web/setup.html', import.meta.url)),
      },
    },
  },
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:8787', '/pair': 'http://localhost:8787' },
  },
});
