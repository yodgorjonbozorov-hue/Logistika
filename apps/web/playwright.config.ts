import { defineConfig, devices } from '@playwright/test';

/**
 * Responsive smoke tests (H-9).
 *
 * These run against a real production build in a real browser at three real
 * viewport widths, because "is the layout broken on a phone" is not a question
 * a jsdom test can answer — it has no layout engine at all.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://127.0.0.1:4173',
    // Chromium ships with the environment. Pointing at it explicitly avoids a
    // download when the installed @playwright/test expects a different build
    // number than the one already on disk.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' },
    channel: undefined,
  },
  projects: [
    {
      name: 'iphone-se',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
