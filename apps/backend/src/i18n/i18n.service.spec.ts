import { ERROR_CODES, LOCALES, type Locale } from 'shared';
import uzCyrl from './messages/uz-cyrl.json';
import uzLatn from './messages/uz-latn.json';
import ru from './messages/ru.json';
import { I18nService } from './i18n.service';

const CATALOGUES: Record<Locale, Record<string, string>> = {
  'uz-latn': uzLatn,
  'uz-cyrl': uzCyrl,
  ru,
};

describe('I18nService', () => {
  const service = new I18nService();

  describe('resolveLocale', () => {
    it('defaults to uz-latn', () => {
      expect(service.resolveLocale(undefined)).toBe('uz-latn');
      expect(service.resolveLocale('fr-FR')).toBe('uz-latn');
    });

    it('matches supported locales from Accept-Language', () => {
      expect(service.resolveLocale('ru-RU,ru;q=0.9')).toBe('ru');
      expect(service.resolveLocale('uz-Cyrl-UZ')).toBe('uz-cyrl');
      expect(service.resolveLocale('uz')).toBe('uz-latn');
      expect(service.resolveLocale('uz-latn')).toBe('uz-latn');
    });
  });

  describe('translate', () => {
    it('translates codes per locale with uz-latn fallback', () => {
      expect(service.translate('NOT_FOUND', 'ru')).toBe('Данные не найдены');
      expect(service.translate('NOT_FOUND', 'uz-cyrl')).toBe('Маълумот топилмади');
      expect(service.translate('NOT_FOUND')).toBe("Ma'lumot topilmadi");
    });

    it('returns the code itself for unknown keys', () => {
      expect(service.translate('SOME_NEW_CODE', 'ru')).toBe('SOME_NEW_CODE');
    });

    it('interpolates {params} and leaves unknown placeholders intact', () => {
      expect(service.translate('X {limit} Y', 'ru', { limit: 5 })).toBe('X 5 Y');
      expect(service.translate('X {other} Y', 'ru', { limit: 5 })).toBe('X {other} Y');
    });
  });
});

/**
 * A missing translation does not fail loudly — `translate` falls back to
 * uz-latn and then to the key itself, which is right at runtime and useless as
 * a warning. These checks are the warning (TZ §3.1: three languages, no
 * hardcoded text).
 */
describe('message catalogues', () => {
  const keys = Object.keys(CATALOGUES['uz-latn']);

  it.each(LOCALES.filter((locale) => locale !== 'uz-latn'))(
    '%s carries every key of the default locale',
    (locale) => {
      const missing = keys.filter((key) => !(key in CATALOGUES[locale]));
      expect(missing).toEqual([]);
    },
  );

  it('has no extra keys that the default locale lacks', () => {
    for (const locale of LOCALES) {
      const extra = Object.keys(CATALOGUES[locale]).filter((key) => !keys.includes(key));
      expect(`${locale}:${extra.join(',')}`).toBe(`${locale}:`);
    }
  });

  it('has no blank translations', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES[locale])) {
        expect(`${locale}.${key}="${value.trim()}"`).not.toBe(`${locale}.${key}=""`);
      }
    }
  });

  it('translates every error code the API can return', () => {
    const untranslated = ERROR_CODES.filter((code) => !(code in CATALOGUES['uz-latn']));
    expect(untranslated).toEqual([]);
  });

  it('keeps the same {placeholders} in every language', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(`${locale}.${key}:${placeholders(CATALOGUES[locale][key] as string)}`).toBe(
          `${locale}.${key}:${placeholders(CATALOGUES['uz-latn'][key] as string)}`,
        );
      }
    }
  });
});
