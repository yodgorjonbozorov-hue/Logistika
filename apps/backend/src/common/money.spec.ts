import { applyBp, divRound, fromScaledInt, ratioBp, sumBigInt, toScaledInt } from './money';

describe('divRound', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 2n)).toBe(2n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(divRound(2n, 3n)).toBe(1n);
  });

  it('keeps the sign when the denominator is negative', () => {
    expect(divRound(5n, -2n)).toBe(-3n);
    expect(divRound(-5n, -2n)).toBe(3n);
  });

  it('stays exact far beyond Number.MAX_SAFE_INTEGER', () => {
    // 90 000 000 000 000 000 tiyin ÷ 3 — a float would already have drifted here.
    expect(divRound(90_000_000_000_000_001n, 3n)).toBe(30_000_000_000_000_000n);
  });

  it('rejects division by zero instead of returning Infinity', () => {
    expect(() => divRound(1n, 0n)).toThrow(RangeError);
  });
});

describe('ratioBp', () => {
  it('returns basis points', () => {
    expect(ratioBp(7n, 100n)).toBe(700);
    expect(ratioBp(1n, 3n)).toBe(3333);
  });

  it('returns null instead of dividing by zero', () => {
    expect(ratioBp(5n, 0n)).toBeNull();
  });

  it('handles negative parts (loss ratios)', () => {
    expect(ratioBp(-25n, 100n)).toBe(-2500);
  });
});

describe('applyBp', () => {
  it('takes a percentage of an amount', () => {
    expect(applyBp(1_250_000n, 1500)).toBe(187_500n);
  });

  it('rounds the tiyin half-up', () => {
    expect(applyBp(101n, 5000)).toBe(51n);
  });
});

describe('sumBigInt', () => {
  it('sums without float drift', () => {
    expect(sumBigInt([1n, 2n, 3n])).toBe(6n);
    expect(sumBigInt([])).toBe(0n);
  });
});

describe('toScaledInt', () => {
  it('scales decimal strings', () => {
    expect(toScaledInt('1240.5', 1)).toBe(12405n);
    expect(toScaledInt('32.50', 2)).toBe(3250n);
    expect(toScaledInt('7', 2)).toBe(700n);
  });

  it('accepts Prisma Decimal-like objects and numbers', () => {
    expect(toScaledInt({ toString: () => '18.75' }, 2)).toBe(1875n);
    expect(toScaledInt(18.5, 1)).toBe(185n);
  });

  it('rounds the truncated tail half-up', () => {
    expect(toScaledInt('12.345', 2)).toBe(1235n);
    expect(toScaledInt('12.344', 2)).toBe(1234n);
  });

  it('keeps negative values negative', () => {
    expect(toScaledInt('-4.25', 2)).toBe(-425n);
  });

  it('returns null for missing or unparseable input', () => {
    expect(toScaledInt(null, 2)).toBeNull();
    expect(toScaledInt(undefined, 2)).toBeNull();
    expect(toScaledInt('', 2)).toBeNull();
    expect(toScaledInt('abc', 2)).toBeNull();
  });
});

describe('fromScaledInt', () => {
  it('renders scaled integers back to decimal strings', () => {
    expect(fromScaledInt(12405n, 1)).toBe('1240.5');
    expect(fromScaledInt(5n, 2)).toBe('0.05');
    expect(fromScaledInt(-425n, 2)).toBe('-4.25');
    expect(fromScaledInt(42n, 0)).toBe('42');
  });
});
