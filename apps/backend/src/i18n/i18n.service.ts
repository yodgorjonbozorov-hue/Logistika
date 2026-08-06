import { Injectable } from '@nestjs/common';
import { DEFAULT_LOCALE, LOCALES, type Locale } from 'shared';
import uzCyrl from './messages/uz-cyrl.json';
import uzLatn from './messages/uz-latn.json';
import ru from './messages/ru.json';

const MESSAGES: Record<Locale, Record<string, string>> = {
  'uz-latn': uzLatn,
  'uz-cyrl': uzCyrl,
  ru,
};

@Injectable()
export class I18nService {
  /** Maps an Accept-Language header value to a supported locale (default uz-latn). */
  resolveLocale(acceptLanguage?: string): Locale {
    if (!acceptLanguage) return DEFAULT_LOCALE;
    const requested = acceptLanguage
      .split(',')
      .map((part) => part.split(';')[0]?.trim().toLowerCase())
      .filter(Boolean) as string[];
    for (const tag of requested) {
      const exact = LOCALES.find((l) => l === tag);
      if (exact) return exact;
      if (tag.startsWith('ru')) return 'ru';
      if (tag.startsWith('uz')) return tag.includes('cyrl') ? 'uz-cyrl' : 'uz-latn';
    }
    return DEFAULT_LOCALE;
  }

  translate(
    code: string,
    locale: Locale = DEFAULT_LOCALE,
    params?: Record<string, string | number>,
  ): string {
    const template = MESSAGES[locale]?.[code] ?? MESSAGES[DEFAULT_LOCALE][code] ?? code;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, key: string) =>
      key in params ? String(params[key]) : match,
    );
  }
}
