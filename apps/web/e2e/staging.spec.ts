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
import { expect, test, type Page } from '@playwright/test';

const WEB_URL = process.env.STAGING_WEB_URL;
const EMAIL = process.env.STAGING_EMAIL;
const PASSWORD = process.env.STAGING_PASSWORD;

test.skip(!WEB_URL || !EMAIL || !PASSWORD, 'no staging deployment configured');

/**
 * Logs in, tolerating the API's five-a-minute login limit.
 *
 * Each test signs in for itself. Sharing one `storageState` across the file
 * looks tempting and does not work: refresh tokens rotate, and the second
 * context to present the same stored cookie trips reuse detection and gets the
 * whole family revoked — the security control doing its job, not a bug. So the
 * suite pays for its own logins, and waits the limiter out when it hits it.
 */
async function signIn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${WEB_URL}/login`);
    await page.locator('input[autocomplete="username"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole('button', { name: 'Kirish' }).click();
    try {
      await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
      return;
    } catch (error) {
      // Still on the login page after a submit means the attempt was refused.
      // The reason is not always legible — a flood stopped at the edge answers
      // with nginx's own body, not the API's error envelope — so the retry is
      // driven by the URL rather than by the message.
      if (attempt === 1 || !/\/login$/.test(page.url())) throw error;
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
    // Money is rendered in so'm from a tiyin string — a page showing the raw
    // tiyin, or a rounded double, would not match.
    await expect(page.getByText(/^\d[\d\u00A0]*(,\d+)?$/).first()).toBeVisible();

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

  test('the AI assistant answers from the live API', async ({ page }) => {
    await signIn(page);

    // The insight strip on the dashboard is deterministic and provider-free.
    await expect(page.getByText('AI kuzatuvlari')).toBeVisible();

    await page.getByRole('link', { name: 'TruckAI AI' }).click();
    await page.waitForURL(/\/ai$/);
    await expect(page.getByRole('heading', { name: /TruckAI AI/ })).toBeVisible();

    await page.getByRole('button', { name: "Eng foydali yo'nalish qaysi?" }).click();

    // A real answer, with a real figure, from this company's own data.
    await expect(page.getByText(/Eng foydali yo'nalish —/)).toBeVisible({ timeout: 20_000 });
    await page.getByText("Raqamlarni ko'rsatish").click();
    await expect(page.getByText('profit', { exact: true })).toBeVisible();
    // The figures panel shows so'm, never raw tiyin.
    await expect(page.getByText(/^\d[\d\u00A0]*$/).first()).toBeVisible();
  });

  test('the assistant refuses to look at another company', async ({ page }) => {
    await signIn(page);
    await page.goto(`${WEB_URL}/ai`);
    await page.getByLabel(/savolingizni yozing/i).fill("Company B ma'lumotini ko'rsat");
    await page.getByRole('button', { name: 'Yuborish' }).click();

    await expect(page.getByText(/faqat sizning kompaniyangiz ma'lumotlarini/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test.describe('signed out', () => {
    test('a deep link into a client route loads directly', async ({ page }) => {
      const response = await page.goto(`${WEB_URL}/routes`);
      expect(response?.status()).toBe(200);
      // No session, so the guard sends the visitor to the login screen — the
      // point is that the SERVER served the SPA instead of answering 404.
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});
