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

describe('i18n locale files', () => {
  it('uz-latn carries every key the app renders', () => {
    expect(LOCALES['uz-latn'].size).toBeGreaterThan(200);
  });

  for (const locale of ['uz-cyrl', 'ru'] as const) {
    it(`${locale} defines every uz-latn key`, () => {
      const missing = [...LOCALES['uz-latn'].keys()].filter((key) => !LOCALES[locale].has(key));
      expect(missing).toEqual([]);
    });

    it(`${locale} defines no keys uz-latn lacks`, () => {
      const extra = [...LOCALES[locale].keys()].filter((key) => !LOCALES['uz-latn'].has(key));
      expect(extra).toEqual([]);
    });

    it(`${locale} uses the same interpolation placeholders as uz-latn`, () => {
      const mismatched = [...LOCALES['uz-latn']]
        .filter(([key, value]) => {
          const translated = LOCALES[locale].get(key);
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
