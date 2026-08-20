/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A production build MUST be told where the API lives.
 *
 * `VITE_API_URL` is baked into the bundle at build time, and the client falls
 * back to `http://localhost:3000/api/v1` when it is absent. A production deploy
 * with the variable unset therefore ships an app that asks every visitor's own
 * machine for data over plain HTTP — it fails for everyone, the CSP blocks it,
 * and nothing about the build says anything is wrong. Failing here turns a
 * silent, total outage into a build error the operator reads immediately.
 *
 * A build that genuinely does not talk to an API (the responsive smoke tests in
 * CI) sets the variable to an unreachable host rather than leaving it empty.
 */
function assertApiUrl(command: string, mode: string): void {
  // Only when actually building. `vite preview` also runs in production mode,
  // and it serves an already-built bundle — refusing to start there would block
  // the responsive Playwright suite for a value that is baked in by then.
  if (command !== 'build' || mode !== 'production') return;
  const url = loadEnv(mode, process.cwd(), '').VITE_API_URL;
  if (!url) {
    throw new Error(
      'VITE_API_URL is required for a production build — set it to the API origin, ' +
        'e.g. VITE_API_URL=https://api.truckcontrol.uz/api/v1, or /api/v1 when the ' +
        'API is served from the same origin as the app',
    );
  }
  // A path such as `/api/v1` means the API is served from the page's own
  // origin — one server, one certificate, no cross-origin request at all. The
  // client resolves it against `window.location.origin`, so it inherits the
  // page's scheme: on an https page it is https, and it cannot be downgraded.
  // That is strictly safer than a cross-origin https URL, not a loophole.
  if (url.startsWith('/')) return;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    throw new Error(`VITE_API_URL must be an https:// origin in production (got ${url})`);
  }
  assertCspAllowsApi(url);
}

/**
 * The Content-Security-Policy served with the app must permit the API origin
 * the bundle was built against.
 *
 * This is the nastiest failure mode this project has, because everything looks
 * fine: the build succeeds, the page loads, the layout renders — and then every
 * request dies in the browser with "Refused to connect", so the login button
 * does nothing and the dashboard shows empty cards. It cannot happen in
 * development, where the dev server sends no CSP at all, so it is discovered in
 * production by a user.
 *
 * `vercel.json` is static and Vercel reads it before the build, so the policy
 * cannot be generated from VITE_API_URL. What can be done is refuse to build a
 * bundle the deployed policy would block.
 */
function assertCspAllowsApi(apiUrl: string): void {
  const configPath = path.resolve(__dirname, 'vercel.json');
  if (!fs.existsSync(configPath)) return; // not the Vercel deployment path

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    headers?: Array<{ headers?: Array<{ key: string; value: string }> }>;
  };
  const csp = config.headers
    ?.flatMap((entry) => entry.headers ?? [])
    .find((header) => header.key.toLowerCase() === 'content-security-policy')?.value;
  if (!csp) return; // no policy to contradict

  const connectSrc = /connect-src ([^;]*)/.exec(csp)?.[1]?.trim();
  if (!connectSrc) return;

  const origin = new URL(apiUrl).origin;
  const allowed = connectSrc.split(/\s+/).some((source) => {
    if (source === "'self'") return false; // cross-origin by definition here
    if (source === '*') return true;
    // `https://*.example.com` covers one label, as the CSP spec defines it.
    if (source.includes('*')) {
      const pattern = new RegExp(`^${source.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]+')}$`);
      return pattern.test(origin);
    }
    return source.replace(/\/$/, '') === origin;
  });

  if (allowed) return;

  const message =
    `The Content-Security-Policy in apps/web/vercel.json does not allow ${origin}, ` +
    `so the browser would block every API request from the deployed app.\n` +
    `Add it to connect-src:\n\n` +
    `    connect-src 'self' ${origin};\n\n` +
    `Current connect-src: ${connectSrc}`;

  // Vercel sets VERCEL=1 in its build environment. There, this file IS the
  // policy the browser will enforce, so a mismatch is fatal. Anywhere else the
  // app is served by nginx with its own headers and vercel.json is inert — the
  // mismatch is still worth saying out loud, but failing the build over a file
  // that will not be used would be wrong.
  if (process.env.VERCEL) throw new Error(message);
  console.warn(`\n[vite] warning: ${message}\n`);
}

export default defineConfig(({ command, mode }) => {
  assertApiUrl(command, mode);
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        shared: path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    server: {
      port: 5173,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      // Unit tests only. `e2e/` holds Playwright specs, which need a real
      // browser and would fail nonsensically under jsdom.
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    },
  };
});
