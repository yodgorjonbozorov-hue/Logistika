import { describe, expect, it } from 'vitest';
import {
  barPercent,
  formatBp,
  formatDecimal,
  formatMonth,
  maxAbs,
  toneForDeviation,
  toneForValue,
} from './format';

/** The formatter groups with a non-breaking space, like the money helpers do. */
const NBSP = '\u00A0';
const nb = (text: string): string => text.replace(/ (?=\d)/g, NBSP);

describe('formatDecimal', () => {
  it('groups thousands and keeps the fraction the server sent', () => {
    expect(formatDecimal('1300.5')).toBe(nb('1 300,5'));
    expect(formatDecimal('310.00')).toBe('310,00');
    expect(formatDecimal('0.0')).toBe('0,0');
    expect(formatDecimal('1234567')).toBe(nb('1 234 567'));
  });

  it('appends a unit when asked', () => {
    expect(formatDecimal('1300.5', 'km')).toBe(nb('1 300,5 km'));
  });

  it('shows an em dash rather than inventing a zero', () => {
    expect(formatDecimal(null)).toBe('—');
    expect(formatDecimal(undefined)).toBe('—');
    expect(formatDecimal('')).toBe('—');
    expect(formatDecimal('not a number')).toBe('—');
  });

  it('keeps a value a double could not hold', () => {
    // Number("9007199254740993") is 9007199254740992 — the parse is textual.
    expect(formatDecimal('9007199254740993')).toBe(nb('9 007 199 254 740 993'));
  });

  it('keeps the sign', () => {
    expect(formatDecimal('-1300.5')).toBe(nb('-1 300,5'));
  });
});

describe('formatBp', () => {
  it('renders basis points as a percentage', () => {
    expect(formatBp(6696)).toBe('66,96 %');
    expect(formatBp(10_000)).toBe('100,00 %');
    expect(formatBp(0)).toBe('0,00 %');
    expect(formatBp(333)).toBe('3,33 %');
  });

  it('honours the requested precision', () => {
    expect(formatBp(6696, { decimals: 1 })).toBe('67,0 %');
    expect(formatBp(6696, { decimals: 0 })).toBe('67 %');
    expect(formatBp(3376, { decimals: 1 })).toBe('33,8 %');
  });

  it('signs a change but not a margin', () => {
    expect(formatBp(13_000, { signed: true, decimals: 0 })).toBe('+130 %');
    expect(formatBp(-2500, { signed: true, decimals: 0 })).toBe('-25 %');
    expect(formatBp(-2500)).toBe('-25,00 %');
  });

  it('groups a large percentage', () => {
    expect(formatBp(15_667, { signed: true, decimals: 0 })).toBe('+157 %');
    expect(formatBp(1_000_000, { decimals: 0 })).toBe(nb('10 000 %'));
  });

  it('shows an em dash for an unknown ratio instead of "0 %"', () => {
    expect(formatBp(null)).toBe('—');
    expect(formatBp(undefined)).toBe('—');
    expect(formatBp(Number.NaN)).toBe('—');
  });
});

describe('toneForValue', () => {
  it('reads a tiyin string without parsing it as a number', () => {
    expect(toneForValue('1540000000')).toBe('good');
    expect(toneForValue('-200000')).toBe('bad');
    expect(toneForValue('0')).toBe('neutral');
    expect(toneForValue('0.00')).toBe('neutral');
  });

  it('handles numbers and unknowns', () => {
    expect(toneForValue(13_000)).toBe('good');
    expect(toneForValue(-1)).toBe('bad');
    expect(toneForValue(null)).toBe('neutral');
    expect(toneForValue(undefined)).toBe('neutral');
  });
});

describe('toneForDeviation', () => {
  it('flags only consumption past the 7 % alert line', () => {
    expect(toneForDeviation(3376)).toBe('bad');
    expect(toneForDeviation(701)).toBe('bad');
    expect(toneForDeviation(700)).toBe('neutral'); // exactly on the line
    expect(toneForDeviation(333)).toBe('neutral');
    expect(toneForDeviation(-1000)).toBe('good'); // beating the norm saves money
    expect(toneForDeviation(null)).toBe('neutral');
  });
});

describe('formatMonth', () => {
  it('turns an ISO month into a readable one', () => {
    expect(formatMonth('2026-08')).toBe('08.2026');
    expect(formatMonth('nonsense')).toBe('nonsense');
  });
});

describe('barPercent / maxAbs', () => {
  it('scales relative to the largest value', () => {
    expect(barPercent('50', '100')).toBe(50);
    expect(barPercent('100', '100')).toBe(100);
    expect(barPercent('0', '100')).toBe(0);
  });

  it('uses the magnitude of a loss, and never overflows the track', () => {
    expect(barPercent('-50', '100')).toBe(50);
    expect(barPercent('200', '100')).toBe(100);
  });

  it('returns 0 rather than dividing by zero', () => {
    expect(barPercent('50', '0')).toBe(0);
  });

  it('stays exact past Number.MAX_SAFE_INTEGER', () => {
    // A double-based ratio of these two would come out as exactly 100.
    expect(barPercent('9007199254740992', '9007199254740993')).toBe(99.9);
    expect(maxAbs(['100', '-9007199254740993', '5'])).toBe('9007199254740993');
  });

  it('finds the largest magnitude in a series', () => {
    expect(maxAbs([])).toBe('0');
    expect(maxAbs(['10', '-20', '15'])).toBe('20');
  });
});
