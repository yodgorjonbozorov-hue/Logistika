/**
 * Runtime lookup, not just file parity. Our locale codes carry a script subtag
 * (`uz-latn`), and i18next re-cases such codes by default — the resource keys
 * then no longer match and every string renders as its raw key. This guards
 * the wiring in ./index.ts against that regression.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES } from 'shared';
import i18n, { setLocale } from './index';

describe('i18n runtime', () => {
  it('resolves the default locale to its own bundle', () => {
    expect(i18n.language).toBe(DEFAULT_LOCALE);
    expect(i18n.resolvedLanguage).toBe(DEFAULT_LOCALE);
  });

  for (const locale of LOCALES) {
    it(`translates instead of echoing the key in ${locale}`, async () => {
      setLocale(locale);
      await i18n.changeLanguage(locale);

      expect(i18n.resolvedLanguage).toBe(locale);
      for (const key of ['nav.overview', 'landing.hero.titleLine1', 'common.mln']) {
        expect(i18n.t(key)).not.toBe(key);
        expect(i18n.t(key).trim()).not.toBe('');
      }
    });
  }

  it('accepts a differently cased code, as a browser may supply', async () => {
    await i18n.changeLanguage('uz-Latn');
    expect(i18n.t('nav.overview')).not.toBe('nav.overview');
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
});
