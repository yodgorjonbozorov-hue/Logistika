/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
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
        'e.g. VITE_API_URL=https://api.truckcontrol.uz/api/v1',
    );
  }
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    throw new Error(`VITE_API_URL must be an https:// origin in production (got ${url})`);
  }
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
