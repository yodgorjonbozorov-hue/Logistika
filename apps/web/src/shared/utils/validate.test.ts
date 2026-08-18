import { describe, expect, it } from 'vitest';
import { checkAmount, checkRecordedDate, checkText, problems } from './validate';

/**
 * These mirror the backend DTOs (TASK-5.3). They are a courtesy, not the rule:
 * the server still decides. What they must not do is disagree with it —
 * rejecting something the API would accept is worse than not checking at all.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString().slice(0, 10);

describe('checkAmount (mirrors @IsTiyin + "money is more than nothing")', () => {
  it('accepts a plain amount', () => {
    expect(checkAmount('1250000')).toBeUndefined();
  });

  it('refuses an empty required amount', () => {
    expect(checkAmount('')).toBeTruthy();
  });

  it('lets an optional amount be empty', () => {
    expect(checkAmount('', { required: false })).toBeUndefined();
  });

  it('refuses zero', () => {
    // The ledger refuses non-positive amounts outright (BUSINESS-RULES §1);
    // saying so at the field beats a round trip.
    expect(checkAmount('0')).toBeTruthy();
    expect(checkAmount('000')).toBeTruthy();
  });

  it('refuses anything that is not digits', () => {
    expect(checkAmount('12.5')).toBeTruthy();
    expect(checkAmount('1e9')).toBeTruthy();
    expect(checkAmount('-5')).toBeTruthy();
  });

  it('accepts an amount past Number.MAX_SAFE_INTEGER', () => {
    // Money is BigInt everywhere; a validator that parsed to Number would
    // reintroduce exactly the bug the rule exists to prevent.
    expect(checkAmount('99999999999999999')).toBeUndefined();
  });
});

describe('checkRecordedDate (mirrors RECORDED_DATE_WINDOW)', () => {
  it('accepts today and yesterday', () => {
    expect(checkRecordedDate(iso(0))).toBeUndefined();
    expect(checkRecordedDate(iso(-DAY))).toBeUndefined();
  });

  it('accepts a date inside the one-day grace the server allows', () => {
    // The server tolerates a day ahead for clock drift, so the client must too.
    expect(checkRecordedDate(iso(0))).toBeUndefined();
  });

  it('refuses a date well into the future', () => {
    expect(checkRecordedDate(iso(30 * DAY))).toBeTruthy();
  });

  it('refuses a year that is obviously a typo', () => {
    expect(checkRecordedDate('1026-08-06')).toBeTruthy();
  });

  it('refuses an unparseable date', () => {
    expect(checkRecordedDate('yesterday')).toBeTruthy();
  });

  it('lets an optional date be empty', () => {
    expect(checkRecordedDate('', { required: false })).toBeUndefined();
    expect(checkRecordedDate('')).toBeTruthy();
  });
});

describe('checkText (mirrors @MaxLength)', () => {
  it('accepts text within the limit', () => {
    expect(checkText('x'.repeat(100), { max: 1000 })).toBeUndefined();
  });

  it('refuses text past the limit', () => {
    expect(checkText('x'.repeat(1001), { max: 1000 })).toBeTruthy();
  });

  it('treats whitespace as empty', () => {
    expect(checkText('   ', { required: true })).toBeTruthy();
    expect(checkText('   ')).toBeUndefined();
  });
});

describe('problems', () => {
  it('keeps only the fields that actually failed', () => {
    expect(problems({ amount: 'bad', date: undefined })).toEqual({ amount: 'bad' });
  });

  it('is empty when everything passed, so Object.keys means "problems"', () => {
    expect(problems({ amount: undefined, date: undefined })).toEqual({});
  });
});
