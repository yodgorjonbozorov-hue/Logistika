/**
 * The translation layer itself.
 *
 * These exist because the app once shipped with every screen rendering its raw
 * key: i18next title-cases a four-letter subtag, so `uz-latn` resolved as
 * `uz-Latn` and matched no bundle. Nothing caught it — the pages rendered, they
 * just said "nav.trips". A key that comes back unchanged is now a failure.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, type Locale } from 'shared';
import i18n from './index';
import ru from './locales/ru.json';
import uzCyrl from './locales/uz-cyrl.json';
import uzLatn from './locales/uz-latn.json';

const BUNDLES: Record<Locale, Record<string, unknown>> = {
  'uz-latn': uzLatn,
  'uz-cyrl': uzCyrl,
  ru,
};

/** Every leaf key, dotted. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

const SAMPLE_KEYS = [
  'nav.dashboard',
  'nav.trips',
  'finance.title',
  'dashboard.revenue',
  'dashboard.presets.thisMonth',
  'routes.title',
  'trips.route',
  'units.km',
];

describe('i18n', () => {
  it('resolves the default locale rather than echoing the key', async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
    for (const key of SAMPLE_KEYS) {
      expect(i18n.t(key), `${key} did not resolve`).not.toBe(key);
    }
  });

  it.each(LOCALES)('resolves every sample key in %s', async (locale) => {
    await i18n.changeLanguage(locale);
    for (const key of SAMPLE_KEYS) {
      const translated = i18n.t(key);
      expect(translated, `${key} did not resolve in ${locale}`).not.toBe(key);
      expect(translated.length).toBeGreaterThan(0);
    }
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('keeps the locale code we asked for, uncapitalised', async () => {
    await i18n.changeLanguage('uz-latn');
    // `uz-Latn` here would mean the bundles are unreachable again.
    expect(i18n.languages[0]).toBe('uz-latn');
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('has the same key set in every locale, so no screen falls back silently', () => {
    const reference = new Set(leafKeys(BUNDLES[DEFAULT_LOCALE]));
    for (const locale of LOCALES) {
      const keys = new Set(leafKeys(BUNDLES[locale]));
      const missing = [...reference].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !reference.has(key));
      expect(missing, `${locale} is missing keys`).toEqual([]);
      expect(extra, `${locale} has keys no other locale has`).toEqual([]);
    }
  });
});
