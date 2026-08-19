/**
 * The web app against a real deployment, in a real browser.
 *
 * Everything else in this repo tests one side at a time: the backend e2e suite
 * drives the API with supertest, the unit tests render React against a mocked
 * client, and `deploy/smoke-test.sh` calls the API with curl. None of them can
 * tell you whether the shipped bundle actually reaches the shipped API — the
 * baked-in `VITE_API_URL`, the CORS origin, the httpOnly refresh cookie and the
 * Content-Security-Policy all only meet each other in a browser.
 *
 * Skipped unless a deployment is named, so the default Playwright run stays
 * offline:
 *
 *   STAGING_WEB_URL=https://staging.truckcontrol.local \
 *   STAGING_EMAIL=owner@example.uz STAGING_PASSWORD=… \
 *   pnpm --filter web exec playwright test --project=staging
 */
import { expect, test } from '@playwright/test';

const WEB_URL = process.env.STAGING_WEB_URL;
const EMAIL = process.env.STAGING_EMAIL;
const PASSWORD = process.env.STAGING_PASSWORD;

test.skip(!WEB_URL || !EMAIL || !PASSWORD, 'no staging deployment configured');

/**
 * Logs in, tolerating the API's five-a-minute login limit.
 *
 * A staging box shares one source address with whatever else is talking to it
 * — `deploy/smoke-test.sh` deliberately floods the login endpoint — so a
 * throttled attempt here is the limiter working, not the app being broken. It
 * is waited out once rather than failing the run.
 */
async function signIn(page: import('@playwright/test').Page): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${WEB_URL}/login`);
    await page.locator('input[autocomplete="username"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole('button', { name: 'Kirish' }).click();
    try {
      await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
      return;
    } catch (error) {
      const text = await page.locator('body').innerText();
      // Anything other than the rate limit is a genuine failure.
      if (!/juda ko|слишком|rate/i.test(text) || attempt === 1) throw error;
      await page.waitForTimeout(61_000);
    }
  }
}

test.describe('staging: the web app talks to the real API', () => {
  test('an owner logs in and the dashboard renders live figures', async ({ page }) => {
    const failures: string[] = [];
    // A CSP violation or a blocked cross-origin call shows up here and nowhere
    // else — the page would simply render empty cards. A 429 is filtered out:
    // signIn() waits the login limiter out and retries, and the browser logs
    // the throttled attempt as a console error either way.
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !/status of 429/.test(text)) failures.push(text);
    });
    page.on('requestfailed', (request) =>
      failures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`),
    );

    // The default landing page is the dashboard, and its figures come from
    // /finance/summary on the other origin.
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Boshqaruv paneli' })).toBeVisible();

    // Every KPI label is present and none of them reads as a raw i18n key.
    for (const label of ['Daromad', 'Xarajat', 'Sof foyda', 'Reyslar']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\b(dashboard|nav|common|finance)\.[a-zA-Z]/);

    // A figure, not a spinner: the request completed and returned numbers.
    await expect(page.locator('.tabular-nums').first()).toBeVisible();

    expect(failures, `console errors / failed requests:\n${failures.join('\n')}`).toEqual([]);
  });

  test('the session survives a full page reload', async ({ page }) => {
    // The access token lives in memory only; a reload has to recover the
    // session from the httpOnly refresh cookie, which requires the cookie to
    // have been set with the right SameSite and the refresh call to be allowed
    // cross-origin with credentials.
    await signIn(page);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Boshqaruv paneli' })).toBeVisible();
  });

  test('a deep link into a client route loads directly', async ({ page }) => {
    const response = await page.goto(`${WEB_URL}/routes`);
    expect(response?.status()).toBe(200);
    // No session yet, so the guard sends the visitor to the login screen — the
    // point is that the SERVER served the SPA instead of answering 404.
    await expect(page).toHaveURL(/\/login$/);
  });
});
