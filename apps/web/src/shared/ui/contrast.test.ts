import { describe, expect, it } from 'vitest';
import palette from './palette.json';

/**
 * WCAG AA contrast, checked rather than eyeballed (L-10, TASK-5.5).
 *
 * The brand palette is built for a dark interface and works there. On white it
 * did not: the amber accent was 2.03:1, below even the 3.0 allowed for large
 * text — the link everybody squints at. These tests pin the darkened text
 * variants so a future palette edit cannot quietly undo it.
 */
const COLORS: Record<string, string> = palette;
const WHITE = '#FFFFFF';

/** Relative luminance, per the WCAG 2.1 definition. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

describe('text colours on a light background', () => {
  it.each(['accent-text', 'success-text', 'danger-text', 'muted-text'])(
    '%s reaches AA for normal text on white',
    (token) => {
      expect(ratio(COLORS[token]!, WHITE)).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );

  it('keeps the darkened variants recognisably the brand colour', () => {
    // They are darker, not different: a "danger" that reads as brown is a
    // different bug from a "danger" nobody can read.
    for (const token of ['accent', 'success', 'danger', 'muted']) {
      expect(ratio(COLORS[`${token}-text`]!, COLORS[token]!)).toBeLessThan(2.5);
    }
  });
});

describe('text colours on the dark background', () => {
  it.each(['accent', 'success', 'muted'])('%s reaches AA on navy', (token) => {
    expect(ratio(COLORS[token]!, COLORS.navy!)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('allows danger on navy at the large-text threshold', () => {
    // 3.60:1 — fine for the bold, larger text it is used on, and documented
    // here rather than left as an accident nobody measured.
    const value = ratio(COLORS.danger!, COLORS.navy!);
    expect(value).toBeGreaterThanOrEqual(AA_LARGE);
    expect(value).toBeLessThan(AA_NORMAL);
  });
});

describe('filled buttons', () => {
  it('reads navy on the accent fill', () => {
    expect(ratio(COLORS.navy!, COLORS.accent!)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('reads white on the danger fill at the large-text threshold', () => {
    expect(ratio(WHITE, COLORS.danger!)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
