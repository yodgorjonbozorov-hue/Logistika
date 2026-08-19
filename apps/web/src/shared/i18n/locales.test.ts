/**
 * Locale parity. CLAUDE.md requires every user-facing string to come from i18n
 * in uz-latn (default), uz-cyrl and ru — so a key added to one file has to
 * exist in all three, with the same interpolation placeholders.
 */
import { describe, expect, it } from 'vitest';
import ru from './locales/ru.json';
import uzCyrl from './locales/uz-cyrl.json';
import uzLatn from './locales/uz-latn.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') flat.set(path, value);
    else for (const [k, v] of flatten(value, path)) flat.set(k, v);
  }
  return flat;
}

const LOCALES = {
  'uz-latn': flatten(uzLatn as Tree),
  'uz-cyrl': flatten(uzCyrl as Tree),
  ru: flatten(ru as Tree),
};

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!).sort();

/**
 * i18next appends a plural category to a key, and which categories exist is a
 * property of the language: Uzbek has one form where Russian has three. Compare
 * what the key *means* — the stem — so parity does not force a locale to carry
 * plural forms its grammar has no use for.
 */
const stem = (key: string): string => key.replace(/_(zero|one|two|few|many|other)$/, '');

const stems = (locale: keyof typeof LOCALES): Set<string> =>
  new Set([...LOCALES[locale].keys()].map(stem));

describe('i18n locale files', () => {
  it('uz-latn carries every key the app renders', () => {
    expect(LOCALES['uz-latn'].size).toBeGreaterThan(200);
  });

  for (const locale of ['uz-cyrl', 'ru'] as const) {
    it(`${locale} defines every uz-latn key`, () => {
      const theirs = stems(locale);
      const missing = [...stems('uz-latn')].filter((key) => !theirs.has(key));
      expect(missing).toEqual([]);
    });

    it(`${locale} defines no keys uz-latn lacks`, () => {
      const ours = stems('uz-latn');
      const extra = [...stems(locale)].filter((key) => !ours.has(key));
      expect(extra).toEqual([]);
    });

    it(`${locale} spells every plural form it declares`, () => {
      const blank = [...LOCALES[locale]]
        .filter(([key, value]) => key !== stem(key) && value.trim() === '')
        .map(([key]) => key);
      expect(blank).toEqual([]);
    });

    it(`${locale} uses the same interpolation placeholders as uz-latn`, () => {
      const mismatched = [...LOCALES['uz-latn']]
        .filter(([key, value]) => {
          // A plural form may be spelled under any category, so compare against
          // whichever one this locale actually declares for the stem.
          const translated =
            LOCALES[locale].get(key) ??
            [...LOCALES[locale]].find(([other]) => stem(other) === stem(key))?.[1];
          return (
            translated !== undefined &&
            placeholders(value).join() !== placeholders(translated).join()
          );
        })
        .map(([key]) => key);
      expect(mismatched).toEqual([]);
    });

    it(`${locale} leaves no value empty`, () => {
      const blank = [...LOCALES[locale]].filter(([, value]) => value.trim() === '').map(([k]) => k);
      expect(blank).toEqual([]);
    });
  }
});
