import { describe, expect, it } from 'vitest';
import { LOCALES } from 'shared';
import ru from './ru.json';
import uzCyrl from './uz-cyrl.json';
import uzLatn from './uz-latn.json';

const BUNDLES: Record<string, unknown> = { 'uz-latn': uzLatn, 'uz-cyrl': uzCyrl, ru };

/** Every leaf key of an object, flattened: "hero.title", "problem.items.0.problem"… */
function keysOf(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keysOf(item, `${prefix}${index}.`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      keysOf(child, `${prefix}${key}.`),
    );
  }
  return [prefix.slice(0, -1)];
}

describe('landing translations', () => {
  it('ships a bundle for every supported locale', () => {
    for (const locale of LOCALES) expect(BUNDLES[locale]).toBeDefined();
  });

  it('covers exactly the same keys in every locale', () => {
    const reference = keysOf(uzLatn).sort();
    expect(reference.length).toBeGreaterThan(50);

    for (const locale of ['uz-cyrl', 'ru'] as const) {
      expect({ locale, keys: keysOf(BUNDLES[locale]).sort() }).toEqual({ locale, keys: reference });
    }
  });

  it('leaves no empty string in place of a translation', () => {
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      const blanks = keysOf(bundle).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            bundle,
          );
        // The «Korporativ» plan intentionally has no price — it is negotiated.
        return value === '' && !key.endsWith('plans.3.price');
      });
      expect({ locale, blanks }).toEqual({ locale, blanks: [] });
    }
  });

  it('keeps the highlight markup of the hero headline in every locale', () => {
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      const title = (bundle as { hero: { title: string } }).hero.title;
      expect({ locale, ok: title.includes('<1>') && title.includes('</1>') }).toEqual({
        locale,
        ok: true,
      });
    }
  });
});
