/// <reference types="vite/client" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';

/** Self-contained preview build — see src/demo/main.tsx. */
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
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, 'demo.html') },
  },
});
