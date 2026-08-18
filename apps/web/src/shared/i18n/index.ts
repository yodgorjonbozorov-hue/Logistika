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
  // Without this i18next title-cases the script subtag ("uz-latn" → "uz-Latn")
  // when resolving, which misses our lower-case resource keys and makes every
  // lookup fall back to the raw key. The locale ids are lower-case everywhere
  // (Accept-Language header, DB, Flutter), so lower-casing is the right fix.
  lowerCaseLng: true,
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
