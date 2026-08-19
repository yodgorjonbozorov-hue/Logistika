import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from 'shared';
import ru from './locales/ru.json';
import uzCyrl from './locales/uz-cyrl.json';
import uzLatn from './locales/uz-latn.json';

const STORAGE_KEY = 'tc.locale';

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
const initialLocale: Locale = (LOCALES as readonly string[]).includes(stored ?? '')
  ? (stored as Locale)
  : DEFAULT_LOCALE;

void i18n.use(initReactI18next).init({
  resources: {
    'uz-latn': { translation: uzLatn },
    'uz-cyrl': { translation: uzCyrl },
    ru: { translation: ru },
  },
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  /**
   * Without this, NOTHING translates.
   *
   * i18next reformats a language code before looking it up: `uz-latn` has a
   * four-letter second part, so it is treated as a script subtag and
   * title-cased to `uz-Latn`. The bundles above are registered under `uz-latn`
   * — the spelling used by the shared `Locale` type, the locale cookie and the
   * `accept-language` header the backend reads — so the resolve hierarchy
   * (`uz-Latn`, `uz`) matched no bundle and every screen rendered its raw key
   * ("nav.trips", "finance.title"). `lowerCaseLng` makes the reformat a plain
   * lower-casing, which leaves our codes untouched.
   */
  lowerCaseLng: true,
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
