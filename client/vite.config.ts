import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The dev server may be reached through a tunnel/preview hostname, not just
    // localhost. This only affects Vite's own host check, never the API's.
    allowedHosts: true,

    /**
     * The browser NEVER calls the API directly. It calls same-origin `/api`,
     * and Vite forwards that to the backend. Two things follow:
     *
     *  1. Auth cookies stay first-party, so SameSite=Lax works and no
     *     cross-origin credentialed request is ever needed.
     *  2. This mirrors production, where a reverse proxy (nginx, Caddy, a
     *     platform router) serves the built SPA and the API under one origin.
     *
     * Because the hop from Vite to Express is server-to-server, the forwarded
     * `Origin`/`Referer` are rewritten to the API's own origin. That is an
     * accurate description of the request the API actually receives — the
     * browser's same-origin policy was already satisfied at the Vite hop — and
     * it keeps the backend's origin allowlist meaningful without having to
     * whitelist every ephemeral tunnel hostname. This is dev-only: in
     * production the reverse proxy fronts both, so Origin is genuinely the
     * site's own origin and no rewriting happens.
     */
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', API_TARGET);
            if (proxyReq.getHeader('referer')) proxyReq.setHeader('referer', `${API_TARGET}/`);
          });
        },
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' },
});
