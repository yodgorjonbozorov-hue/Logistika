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
  // Our locale codes carry a script subtag (`uz-latn`, `uz-cyrl`) and i18next
  // would otherwise re-case them to `uz-Latn` / `uz-Cyrl`, which no longer
  // match the resource keys above — every lookup would fall through to the
  // raw key. Keeping codes lower-cased makes them line up again, and also
  // absorbs whatever casing a browser or a stored preference hands us.
  lowerCaseLng: true,
  cleanCode: true,
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
