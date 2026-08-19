import { describe, expect, it } from 'vitest';
import { LOCALES } from 'shared';
import i18n from './index';

/** Flattens a translation tree into dotted keys for cross-locale comparison. */
function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n', () => {
  it('resolves keys for the default locale', () => {
    expect(i18n.t('trips.title')).toBe('Reyslar');
    expect(i18n.t('brand.name')).toBe('Logixa AI');
  });

  it('resolves keys in every supported locale', () => {
    for (const locale of LOCALES) {
      expect(i18n.getFixedT(locale)('nav.trips')).not.toBe('nav.trips');
    }
  });

  it('keeps all locales at key parity — no untranslated screen', () => {
    const base = keysOf(i18n.getResourceBundle('uz-latn', 'translation')).sort();
    for (const locale of LOCALES) {
      expect(keysOf(i18n.getResourceBundle(locale, 'translation')).sort()).toEqual(base);
    }
  });
});
