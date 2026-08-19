import { describe, expect, it } from 'vitest';
import { customPeriod, periodEndInput, periodStartInput, resolvePeriod } from './period';

// A mid-month instant in a timezone-sensitive spot: 03:00 UTC on the 15th is
// still the 15th locally in Tashkent (UTC+5), but 22:00 UTC on the 31st is
// already the 1st there — the case that makes local month maths wrong.
const NOW = new Date('2026-08-15T03:00:00.000Z');

describe('resolvePeriod', () => {
  it('covers exactly the current calendar month, in UTC', () => {
    expect(resolvePeriod('thisMonth', NOW)).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
  });

  it('covers the previous month', () => {
    expect(resolvePeriod('lastMonth', NOW)).toEqual({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
  });

  it('rolls the year over at January', () => {
    const january = new Date('2026-01-10T12:00:00.000Z');
    expect(resolvePeriod('lastMonth', january)).toEqual({
      from: '2025-12-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
  });

  it('ends the rolling windows at tomorrow, so today is included in full', () => {
    expect(resolvePeriod('last30', NOW)).toEqual({
      from: '2026-07-17T00:00:00.000Z',
      to: '2026-08-16T00:00:00.000Z',
    });
    expect(resolvePeriod('last90', NOW).from).toBe('2026-05-18T00:00:00.000Z');
  });

  it('covers the calendar year', () => {
    expect(resolvePeriod('thisYear', NOW)).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
  });

  it('does not shift a month boundary with the local timezone', () => {
    // 22:00 UTC on 31 August is 03:00 on 1 September in Tashkent. The window
    // must still be August.
    const lateNight = new Date('2026-08-31T22:00:00.000Z');
    expect(resolvePeriod('thisMonth', lateNight).from).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('customPeriod', () => {
  it('turns an inclusive date picker range into a half-open window', () => {
    // "1 August to 31 August" must include everything that happened on the 31st.
    expect(customPeriod('2026-08-01', '2026-08-31')).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
  });

  it('accepts a single day', () => {
    expect(customPeriod('2026-08-15', '2026-08-15')).toEqual({
      from: '2026-08-15T00:00:00.000Z',
      to: '2026-08-16T00:00:00.000Z',
    });
  });

  it('rejects an inverted range instead of asking the API for a 400', () => {
    expect(customPeriod('2026-08-31', '2026-08-01')).toBeNull();
  });

  it('rejects a range past the API cap of 400 days', () => {
    expect(customPeriod('2024-01-01', '2026-08-01')).toBeNull();
    expect(customPeriod('2025-08-01', '2026-08-01')).not.toBeNull();
  });

  it('rejects incomplete or unparsable input', () => {
    expect(customPeriod('', '2026-08-01')).toBeNull();
    expect(customPeriod('2026-08-01', '')).toBeNull();
    expect(customPeriod('not-a-date', '2026-08-01')).toBeNull();
  });
});

describe('period inputs', () => {
  it('round-trips through the inclusive date picker', () => {
    const period = customPeriod('2026-08-01', '2026-08-31')!;
    expect(periodStartInput(period)).toBe('2026-08-01');
    expect(periodEndInput(period)).toBe('2026-08-31');
  });

  it('shows a preset window with the end date a human would expect', () => {
    const period = resolvePeriod('thisMonth', NOW);
    expect(periodStartInput(period)).toBe('2026-08-01');
    expect(periodEndInput(period)).toBe('2026-08-31');
  });
});
