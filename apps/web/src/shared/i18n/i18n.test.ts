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
