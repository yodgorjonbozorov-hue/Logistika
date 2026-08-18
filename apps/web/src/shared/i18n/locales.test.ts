import { describe, expect, it } from 'vitest';
import { LOCALES } from 'shared';
import ru from './locales/ru.json';
import uzCyrl from './locales/uz-cyrl.json';
import uzLatn from './locales/uz-latn.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flatten(value, path);
  });
}

const BUNDLES: Record<string, Tree> = {
  'uz-latn': uzLatn as Tree,
  'uz-cyrl': uzCyrl as Tree,
  ru: ru as Tree,
};

describe('i18n locales', () => {
  const reference = flatten(BUNDLES['uz-latn']!).sort();

  it('ships a bundle for every declared locale', () => {
    expect(Object.keys(BUNDLES).sort()).toEqual([...LOCALES].sort());
  });

  for (const locale of Object.keys(BUNDLES)) {
    it(`${locale} covers exactly the uz-latn key set`, () => {
      const keys = flatten(BUNDLES[locale]!).sort();
      expect(keys.filter((key) => !reference.includes(key))).toEqual([]); // extra
      expect(reference.filter((key) => !keys.includes(key))).toEqual([]); // missing
    });

    it(`${locale} has no empty translations`, () => {
      const empty = flatten(BUNDLES[locale]!).filter((key) => {
        const value = key
          .split('.')
          .reduce<string | Tree | undefined>(
            (node, part) => (typeof node === 'object' ? node[part] : undefined),
            BUNDLES[locale],
          );
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empty).toEqual([]);
    });
  }
});
