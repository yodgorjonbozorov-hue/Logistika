import { describe, expect, it } from 'vitest';
import { LOCALES } from 'shared';
import i18n, { setLocale } from './index';

/**
 * Guards the language-code regression that once made the whole UI render raw
 * keys: i18next title-cases script subtags ("uz-latn" → "uz-Latn") while our
 * resource bundles are keyed lower-case, so every lookup silently fell back to
 * the key itself.
 */
describe('i18n runtime resolution', () => {
  it('resolves the resource bundle for every locale, not the raw key', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      expect(i18n.resolvedLanguage).toBe(locale);
      for (const key of ['common.save', 'landing.heroTitle', 'nav.dashboard', 'status.DRAFT']) {
        expect(i18n.t(key), `${locale} → ${key}`).not.toBe(key);
      }
    }
  });

  it('interpolates counts in the driver queue strings', () => {
    setLocale('uz-latn');
    const message = i18n.t('driver.queued', { count: 3 });
    expect(message).toContain('3');
    expect(message).not.toContain('{{count}}');
  });
});
