import { describe, expect, it } from 'vitest';
import {
  amountTone,
  currentMonthPeriod,
  dayBounds,
  formatBp,
  formatDecimal,
  isNegative,
  toDateInput,
} from './format';

describe('formatBp', () => {
  it('renders basis points as a percent', () => {
    expect(formatBp(2336)).toBe('23.36%');
    expect(formatBp(-2000)).toBe('-20.00%');
    expect(formatBp(0)).toBe('0.00%');
  });

  it('shows a dash when the ratio is undefined', () => {
    expect(formatBp(null)).toBe('—');
    expect(formatBp(undefined)).toBe('—');
  });
});

describe('formatDecimal', () => {
  it('keeps the requested precision', () => {
    expect(formatDecimal('1240.0', 1)).toBe(`1${'\u00A0'}240,0`);
    expect(formatDecimal('55.2', 2)).toBe('55,20');
  });

  it('falls back to a dash for empty or broken values', () => {
    expect(formatDecimal(null)).toBe('—');
    expect(formatDecimal('')).toBe('—');
    expect(formatDecimal('abc')).toBe('—');
  });
});

describe('amountTone / isNegative', () => {
  it('marks losses red', () => {
    expect(amountTone('-500')).toBe('text-danger');
    expect(amountTone('500')).toBe('text-success');
    expect(isNegative('-1')).toBe(true);
    expect(isNegative(null)).toBe(false);
  });
});

describe('period helpers', () => {
  it('defaults to the running month', () => {
    const period = currentMonthPeriod(new Date('2026-08-15T12:00:00Z'));
    expect(period.from).toBe('2026-08-01T00:00:00.000Z');
    expect(period.to).toBe('2026-08-15T12:00:00.000Z');
  });

  it('turns a date input into day bounds', () => {
    expect(dayBounds('2026-08-15')).toBe('2026-08-15T00:00:00.000Z');
    expect(dayBounds('2026-08-15', true)).toBe('2026-08-15T23:59:59.999Z');
  });

  it('turns an ISO string back into a date input value', () => {
    expect(toDateInput('2026-08-15T23:59:59.999Z')).toBe('2026-08-15');
  });
});
