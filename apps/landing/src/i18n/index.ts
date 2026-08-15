import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from 'shared';
import ru from './ru.json';
import uzCyrl from './uz-cyrl.json';
import uzLatn from './uz-latn.json';

const STORAGE_KEY = 'tc.landing.locale';

/** A visitor arriving with a Russian browser should land on the Russian copy. */
function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if ((LOCALES as readonly string[]).includes(stored ?? '')) return stored as Locale;

  const browser = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : '';
  if (browser.startsWith('ru')) return 'ru';
  if (browser.includes('cyrl')) return 'uz-cyrl';
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    'uz-latn': { translation: uzLatn },
    'uz-cyrl': { translation: uzCyrl },
    ru: { translation: ru },
  },
  lng: detectLocale(),
  fallbackLng: DEFAULT_LOCALE,
  // i18next would otherwise resolve "uz-latn" as "uz-Latn" and miss the bundle.
  lowerCaseLng: true,
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale.startsWith('uz') ? 'uz' : locale;
  void i18n.changeLanguage(locale);
}

export default i18n;
