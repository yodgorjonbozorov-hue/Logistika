import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Build of the panel that runs on fixtures instead of the API (`src/demo/`).
 * Kept in its own config so the production build stays exactly as it was.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      shared: path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist-demo',
    rollupOptions: { input: path.resolve(__dirname, 'demo.html') },
  },
});
