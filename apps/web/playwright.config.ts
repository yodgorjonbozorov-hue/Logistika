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
      testIgnore: /staging\.spec\.ts/,
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
      testIgnore: /staging\.spec\.ts/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /staging\.spec\.ts/,
    },
    {
      // Runs only when STAGING_WEB_URL names a deployment; the spec skips
      // itself otherwise. `ignoreHTTPSErrors` is for the self-signed staging
      // certificate — the certificate itself is verified properly, against its
      // CA, by deploy/smoke-test.sh.
      name: 'staging',
      testMatch: /staging\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: process.env.STAGING_WEB_URL,
        ignoreHTTPSErrors: true,
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
          // Chromium does not honour NO_PROXY, and a bypass list only applies
          // to a proxy given on the command line — so a staging host on the
          // local network is sent to whatever HTTPS_PROXY names and fails to
          // connect. STAGING_BROWSER_DIRECT=1 forces direct connections, which
          // is what a staging box on the same host needs.
          args: [
            ...(process.env.NO_PROXY ? [`--proxy-bypass-list=${process.env.NO_PROXY}`] : []),
            ...(process.env.STAGING_BROWSER_DIRECT ? ['--no-proxy-server'] : []),
          ],
        },
      },
    },
  ],
  // Skipped for the staging project, which targets a deployment that is
  // already running.
  webServer: process.env.STAGING_WEB_URL
    ? undefined
    : {
        command: 'npx vite preview --port 4173 --host 127.0.0.1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
