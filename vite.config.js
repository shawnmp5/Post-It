import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * In `npm run dev`, answer /api/* with the same account code Netlify runs, backed by an
 * in-memory store (accounts last until the dev server stops). The built site uses the
 * Netlify Function in netlify/functions/api.mjs instead.
 */
function localApi() {
  let handle = null;
  return {
    name: 'postit-local-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        if (!handle) {
          const { createAccounts } = await import('./netlify/lib/accounts.mjs');
          const { memoryStore } = await import('./netlify/lib/memoryStore.mjs');
          handle = createAccounts(memoryStore);
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const request = new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        const response = await handle(request);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
});
