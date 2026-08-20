import { defineConfig, devices } from '@playwright/test';

/**
 * Responsive smoke tests (H-9).
 *
 * These run against a real production build in a real browser at three real
 * viewport widths, because "is the layout broken on a phone" is not a question
 * a jsdom test can answer — it has no layout engine at all.
 */
/**
 * Chromium ships with the environment; naming it explicitly avoids a download
 * when the installed @playwright/test expects a different build number.
 *
 * Chromium does not honour NO_PROXY, and a bypass list only applies to a proxy
 * given on the command line — so a deployment on the local network is sent to
 * whatever HTTPS_PROXY names and fails to connect with ERR_TUNNEL_CONNECTION_
 * FAILED. STAGING_BROWSER_DIRECT=1 forces direct connections.
 */
const BROWSER_LAUNCH = {
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: [
    ...(process.env.NO_PROXY ? [`--proxy-bypass-list=${process.env.NO_PROXY}`] : []),
    ...(process.env.STAGING_BROWSER_DIRECT ? ['--no-proxy-server'] : []),
  ],
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://127.0.0.1:4173',
    // The responsive projects normally target the local preview server, which
    // the proxy ignores. Pointed at a real deployment they need the same
    // treatment the staging project needs, so the options are shared rather
    // than duplicated — see the note on the staging project below.
    ignoreHTTPSErrors: true,
    launchOptions: BROWSER_LAUNCH,
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
      // Room for one wait-out of the login rate limit (see signIn()).
      timeout: 150_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: process.env.STAGING_WEB_URL,
        ignoreHTTPSErrors: true,
        launchOptions: BROWSER_LAUNCH,
      },
    },
  ],
  // Skipped for the staging project, which targets a deployment that is
  // already running.
  webServer:
    process.env.STAGING_WEB_URL || process.env.WEB_BASE_URL
      ? undefined
      : {
          command: 'npx vite preview --port 4173 --host 127.0.0.1',
          url: 'http://127.0.0.1:4173',
          reuseExistingServer: true,
          timeout: 120_000,
        },
});
