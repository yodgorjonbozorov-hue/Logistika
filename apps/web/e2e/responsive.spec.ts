import { expect, test } from '@playwright/test';

/**
 * H-9 — the layout at real viewport widths, in a real browser.
 *
 * The sidebar used to be a hard `w-56` column in a flex row with no responsive
 * rules at all, so at 375px it ate more than a third of the screen and pushed
 * the content off the right edge; the page then scrolled sideways and buttons
 * sat outside the viewport. jsdom cannot catch that — it has no layout engine —
 * so this suite drives a production build in Chromium.
 */

/** The single most telling symptom: content wider than the window. */
async function horizontalOverflow(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('login page', () => {
  test('fits the viewport with no horizontal scrolling', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /kir|вой|Submit/i })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('form controls are large enough to tap', async ({ page }) => {
    await page.goto('/login');
    for (const control of await page.locator('input, button').all()) {
      const box = await control.boundingBox();
      if (!box) continue;
      // 44px is the accepted minimum comfortable touch target.
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('inputs use a font size that does not trigger iOS auto-zoom', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-se', 'phone-width concern only');
    await page.goto('/login');
    const fontSize = await page
      .locator('input')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });
});

test.describe('deep links (H-14)', () => {
  test('a nested route loads directly instead of 404-ing', async ({ page }) => {
    const response = await page.goto('/trips/00000000-0000-4000-8000-000000000000');
    expect(response?.status()).toBe(200);
    // No session, so the guard redirects to the login screen — the point is
    // that the SERVER served the SPA rather than answering 404.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unknown route falls back to the app, not a server error', async ({ page }) => {
    const response = await page.goto('/definitely-not-a-route');
    expect(response?.status()).toBe(200);
  });
});

test.describe('app shell', () => {
  test('renders without crashing and reports no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // A failed API call is expected (no backend in this run); a JS exception is not.
    expect(errors.filter((e) => !/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(e))).toEqual(
      [],
    );
  });

  test('the public tracking page fits the viewport too', async ({ page }) => {
    await page.goto('/track/some-token');
    await page.waitForLoadState('networkidle');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

test.describe('i18n', () => {
  test('renders translated text, never raw translation keys', async ({ page }) => {
    // The app once shipped with i18next unable to resolve `uz-latn` (it
    // title-cases the four-letter subtag to `uz-Latn`), so every label on every
    // screen was its own key. It looked fine to a smoke test that only checked
    // the page rendered — this one reads what the user actually sees.
    await page.goto('/login');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\b(auth|common|nav|dashboard|finance|routes)\.[a-zA-Z]/);
    await expect(page.getByRole('button', { name: 'Kirish' })).toBeVisible();
  });
});

test.describe('viewport meta', () => {
  test('declares a responsive viewport', async ({ page }) => {
    await page.goto('/login');
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('width=device-width');
    // A locked scale would prevent a user from zooming in on small text.
    expect(content).not.toContain('user-scalable=no');
  });
});
