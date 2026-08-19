/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';

export default defineConfig(({ command, mode }) => {
  // A production build with no VITE_API_URL would silently bake in the dev
  // fallback (http://localhost:3000), so every deployed page would call the
  // visitor's own machine. Fail the build instead of shipping that.
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, path.resolve(__dirname), '');
    if (!env.VITE_API_URL) {
      throw new Error(
        'VITE_API_URL is required for a production build — set it to the deployed API base, ' +
          'e.g. https://<api-host>/api/v1 (see docs/DEPLOY.md).',
      );
    }
  }

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
    },
  };
});
