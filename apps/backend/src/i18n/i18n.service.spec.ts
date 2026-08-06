import { I18nService } from './i18n.service';

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
