import { describe, expect, it } from 'vitest';
import { LOCALES } from 'shared';
import i18n, { setLocale } from './index';

/**
 * i18next rewrites a code like "uz-latn" to "uz-Latn" while resolving, so a
 * lowercase resource key silently misses and every screen shows raw keys.
 * These tests pin the resolution down for all three locales.
 */
describe('i18n resource resolution', () => {
  it('resolves keys in the default locale instead of echoing them back', () => {
    expect(i18n.t('auth.loginTitle')).not.toBe('auth.loginTitle');
    expect(i18n.t('nav.dashboard')).not.toBe('nav.dashboard');
  });

  it('resolves keys in every supported locale', async () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      await i18n.changeLanguage(locale);
      expect(i18n.language).toBe(locale);
      expect(i18n.t('finance.profit')).not.toBe('finance.profit');
    }
    setLocale('uz-latn');
    await i18n.changeLanguage('uz-latn');
  });

  it('interpolates alert params', () => {
    expect(i18n.t('alerts.serviceInKm', { km: 500 })).toContain('500');
  });
});

/** Flattens a resource bundle to "a.b.c" keys so locales can be compared. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locale coverage', () => {
  const bundles = Object.fromEntries(
    LOCALES.map((locale) => [locale, flatten(i18n.getResourceBundle(locale, 'translation'))]),
  );

  it.each(LOCALES.filter((locale) => locale !== 'uz-latn'))(
    '%s has every key of the default locale',
    (locale) => {
      const missing = bundles['uz-latn']!.filter((key) => !bundles[locale]!.includes(key));
      expect(missing).toEqual([]);
    },
  );

  it('has no blank translations', () => {
    for (const locale of LOCALES) {
      for (const key of bundles[locale]!) {
        expect(`${locale}:${key}=${i18n.getFixedT(locale)(key)}`).not.toMatch(/=\s*$/);
      }
    }
  });
});
