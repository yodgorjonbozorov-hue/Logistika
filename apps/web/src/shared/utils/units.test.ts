import { describe, expect, it } from 'vitest';
import { formatBp, formatKm10, formatLitersCenti, formatMonth } from './units';

/** The API sends integers; these are the only places they become readable text. */
describe('formatBp', () => {
  it('turns basis points into a signed percentage', () => {
    expect(formatBp(4497)).toBe('+44.97%');
    expect(formatBp(-1391)).toBe('-13.91%');
    expect(formatBp(700, { signed: false })).toBe('7%');
  });

  it('drops the decimals when the percentage is whole', () => {
    expect(formatBp(5000)).toBe('+50%');
    expect(formatBp(0)).toBe('0%');
  });

  it('shows an em dash for a missing value rather than NaN', () => {
    expect(formatBp(null)).toBe('—');
    expect(formatBp(undefined)).toBe('—');
    expect(formatBp(Number.NaN)).toBe('—');
  });
});

describe('formatKm10', () => {
  it('groups thousands and keeps the tenth only when it matters', () => {
    expect(formatKm10(12_400)).toBe('1 240');
    expect(formatKm10(2784)).toBe('278.4');
    expect(formatKm10(0)).toBe('0');
  });
});

describe('formatLitersCenti', () => {
  it('reads hundredths of a litre', () => {
    expect(formatLitersCenti(39_680)).toBe('396.8');
    expect(formatLitersCenti(45_200)).toBe('452');
  });

  it('marks an overrun with a plus, a saving with its own minus', () => {
    expect(formatLitersCenti(5520, { signed: true })).toBe('+55.2');
    expect(formatLitersCenti(-1400, { signed: true })).toBe('-14');
  });
});

describe('formatMonth', () => {
  it('renders an ISO month as the local reading order', () => {
    expect(formatMonth('2026-08')).toBe('08.2026');
  });
});
