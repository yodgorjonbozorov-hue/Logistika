import { AppException } from '../../common/exceptions/app.exception';
import {
  asObject,
  confidenceBp,
  optionalDate,
  optionalEnum,
  optionalNumber,
  optionalString,
  requiredEnum,
  requiredString,
} from './ai.validation';

function expectRejected(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect((error as AppException).code).toBe('AI_INVALID_RESPONSE');
    return;
  }
  throw new Error('expected the value to be rejected');
}

describe('asObject', () => {
  it('rejects anything that is not a plain object', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expectRejected(() => asObject(null));
    expectRejected(() => asObject([1, 2]));
    expectRejected(() => asObject('{"a":1}'));
  });
});

describe('optionalString', () => {
  it('turns the model ways of saying "nothing" into null', () => {
    const source = { a: null, b: '', c: 'null', d: '   ' };
    for (const field of ['a', 'b', 'c', 'd', 'missing']) {
      expect(optionalString(source, field)).toBeNull();
    }
  });

  it('trims and caps the length', () => {
    expect(optionalString({ a: '  AZS Jizzax  ' }, 'a')).toBe('AZS Jizzax');
    expect(optionalString({ a: 'x'.repeat(999) }, 'a', 10)).toHaveLength(10);
  });

  it('rejects a non-string and a missing required field', () => {
    expectRejected(() => optionalString({ a: 42 }, 'a'));
    expectRejected(() => requiredString({}, 'a'));
  });
});

describe('optionalNumber', () => {
  it('accepts numbers and the numeric strings models like to produce', () => {
    expect(optionalNumber({ liters: 300 }, 'liters')).toBe(300);
    expect(optionalNumber({ amount: '4200000' }, 'amount')).toBe(4_200_000);
    expect(optionalNumber({ amount: '4 200 000' }, 'amount')).toBe(4_200_000);
  });

  it('rejects negatives, junk and out-of-range values', () => {
    expectRejected(() => optionalNumber({ a: -1 }, 'a'));
    expectRejected(() => optionalNumber({ a: 'ko‘p' }, 'a'));
    expectRejected(() => optionalNumber({ a: Infinity }, 'a'));
    expectRejected(() => optionalNumber({ a: 5 }, 'a', 1));
  });

  it('keeps null distinct from zero', () => {
    expect(optionalNumber({}, 'a')).toBeNull();
    expect(optionalNumber({ a: 0 }, 'a')).toBe(0);
  });
});

describe('optionalEnum', () => {
  const CATEGORIES = ['fuel', 'toll', 'other'] as const;

  it('matches case-insensitively and rejects an invented value', () => {
    expect(optionalEnum({ c: 'FUEL' }, 'c', CATEGORIES)).toBe('fuel');
    expect(optionalEnum({}, 'c', CATEGORIES)).toBeNull();
    expectRejected(() => optionalEnum({ c: 'benzin' }, 'c', CATEGORIES));
    expectRejected(() => requiredEnum({}, 'c', CATEGORIES));
  });
});

describe('confidenceBp', () => {
  it('converts 0.0–1.0 to basis points so the 0.7 rule is exact', () => {
    expect(confidenceBp({ confidence: 0.7 })).toBe(7000);
    expect(confidenceBp({ confidence: 0.945 })).toBe(9450);
    expect(confidenceBp({ confidence: 1 })).toBe(10_000);
    expect(confidenceBp({})).toBeNull();
  });

  it('rejects a confidence outside the documented range', () => {
    expectRejected(() => confidenceBp({ confidence: 95 }));
  });
});

describe('optionalDate', () => {
  it('parses an ISO date and rejects unparseable text', () => {
    expect(optionalDate({ d: '2026-08-16' }, 'd')?.toISOString()).toBe('2026-08-16T00:00:00.000Z');
    expect(optionalDate({ d: null }, 'd')).toBeNull();
    expectRejected(() => optionalDate({ d: 'kecha' }, 'd'));
  });
});
