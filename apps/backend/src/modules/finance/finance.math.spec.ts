import {
  asBigInt,
  consumptionCl100km,
  consumptionDeviationBp,
  decimalStringToInt,
  divRound,
  intToDecimalString,
  marginBp,
  perKm,
  ratioBp,
  sumBigInt,
  toScaledInt,
} from './finance.math';

describe('divRound', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 2n)).toBe(2n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(divRound(2n, 3n)).toBe(1n);
  });

  it('handles negative denominators', () => {
    expect(divRound(5n, -2n)).toBe(-3n);
    expect(divRound(-5n, -2n)).toBe(3n);
  });

  it('refuses to divide by zero rather than returning Infinity', () => {
    expect(() => divRound(1n, 0n)).toThrow('division by zero');
  });

  it('is exact far beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(divRound(huge * 3n, 3n)).toBe(huge);
  });
});

describe('decimalStringToInt', () => {
  it('scales a decimal string to the smallest unit', () => {
    expect(decimalStringToInt('1250.50', 2)).toBe(125050n);
    expect(decimalStringToInt('1250.5', 2)).toBe(125050n);
    expect(decimalStringToInt('1250', 2)).toBe(125000n);
    expect(decimalStringToInt('0.01', 2)).toBe(1n);
    expect(decimalStringToInt('0', 2)).toBe(0n);
  });

  it('handles the distance scale of one decimal place', () => {
    expect(decimalStringToInt('1234.5', 1)).toBe(12345n);
    expect(decimalStringToInt('1234', 1)).toBe(12340n);
  });

  it('keeps the sign', () => {
    expect(decimalStringToInt('-12.34', 2)).toBe(-1234n);
  });

  it('rejects more precision than the scale can hold, rather than silently rounding', () => {
    expect(() => decimalStringToInt('1.234', 2)).toThrow('More than 2 decimal places');
  });

  it('rejects things that are not numbers', () => {
    for (const bad of ['abc', '', '1.2.3', '1e5', ' 12 34', 'NaN', 'Infinity']) {
      expect(() => decimalStringToInt(bad, 2)).toThrow();
    }
  });

  it('never loses precision on a value a double could not hold', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; here it is exact.
    expect(decimalStringToInt('0.10', 2) + decimalStringToInt('0.20', 2)).toBe(30n);
    expect(decimalStringToInt('99999999999999999.99', 2)).toBe(9999999999999999999n);
  });
});

describe('intToDecimalString', () => {
  it('round-trips with decimalStringToInt', () => {
    for (const value of ['0.00', '1250.50', '-12.34', '999999.99']) {
      expect(intToDecimalString(decimalStringToInt(value, 2), 2)).toBe(
        value.replace(/^(-?)(\d+)\.(\d)$/, '$1$2.$30'),
      );
    }
  });

  it('pads the fraction', () => {
    expect(intToDecimalString(5n, 2)).toBe('0.05');
    expect(intToDecimalString(50n, 2)).toBe('0.50');
    expect(intToDecimalString(-5n, 2)).toBe('-0.05');
  });

  it('returns a plain integer at scale 0', () => {
    expect(intToDecimalString(1234n, 0)).toBe('1234');
  });
});

describe('toScaledInt', () => {
  it('accepts a Prisma Decimal-like object', () => {
    const decimal = { toFixed: (digits: number) => (1250.5).toFixed(digits) };
    expect(toScaledInt(decimal, 2)).toBe(125050n);
  });

  it('accepts a raw string from a SQL sum', () => {
    expect(toScaledInt('1250.50', 2)).toBe(125050n);
  });

  it('treats null and undefined as zero', () => {
    expect(toScaledInt(null, 2)).toBe(0n);
    expect(toScaledInt(undefined, 2)).toBe(0n);
  });
});

describe('ratioBp / marginBp', () => {
  it('expresses a ratio in basis points', () => {
    expect(ratioBp(1n, 2n)).toBe(5000); // 50%
    expect(ratioBp(1n, 4n)).toBe(2500); // 25%
    expect(ratioBp(1n, 1n)).toBe(10_000); // 100%
    expect(ratioBp(1n, 3n)).toBe(3333); // 33.33%
  });

  it('returns 0 rather than Infinity when the base is zero', () => {
    expect(ratioBp(100n, 0n)).toBe(0);
  });

  it('reports a loss as a negative margin', () => {
    // 800 000 revenue, 1 000 000 cost → −200 000 profit → −25%
    expect(marginBp(-200_000n, 800_000n)).toBe(-2500);
  });

  it('computes a realistic trip margin exactly', () => {
    const revenue = 900_000_000n; // 9 000 000 so'm
    const expenses = 623_450_000n; // 6 234 500 so'm
    expect(marginBp(revenue - expenses, revenue)).toBe(3073); // 30.73%
  });
});

describe('perKm', () => {
  it('converts tiyin over hectometres into tiyin per kilometre', () => {
    // 1 000 000 tiyin over 500.0 km (5000 hm) → 2000 tiyin/km
    expect(perKm(1_000_000n, 5000n)).toBe(2000n);
  });

  it('rounds rather than truncating', () => {
    expect(perKm(1000n, 30n)).toBe(333n); // 1000 × 10 / 30 = 333.33
    expect(perKm(1000n, 15n)).toBe(667n); // 666.67 → 667
  });

  it('returns null for an unknown distance instead of a misleading zero', () => {
    expect(perKm(1_000_000n, 0n)).toBeNull();
    expect(perKm(1_000_000n, -1n)).toBeNull();
  });
});

describe('consumptionCl100km', () => {
  it('computes L/100km ×100 from centilitres and hectometres', () => {
    // 302.00 L over 1000.0 km → 30.20 L/100km → 3020 cl/100km
    expect(consumptionCl100km(30_200n, 10_000n)).toBe(3020n);
    // 50.00 L over 100.0 km → 50.00 L/100km
    expect(consumptionCl100km(5000n, 1000n)).toBe(5000n);
  });

  it('keeps two decimals of precision', () => {
    // 123.45 L over 456.7 km → 27.0308… → 2703
    expect(consumptionCl100km(12_345n, 4567n)).toBe(2703n);
  });

  it('returns null when the distance is unknown', () => {
    expect(consumptionCl100km(30_200n, 0n)).toBeNull();
  });

  it('returns null for a negative volume rather than inventing a figure', () => {
    expect(consumptionCl100km(-1n, 1000n)).toBeNull();
  });
});

describe('consumptionDeviationBp', () => {
  it('is positive when the truck burns more than its norm', () => {
    // norm 30.00, actual 33.00 → +10%
    expect(consumptionDeviationBp(3300n, 3000n)).toBe(1000);
  });

  it('is negative when the truck beats its norm', () => {
    expect(consumptionDeviationBp(2700n, 3000n)).toBe(-1000);
  });

  it('is zero on the norm exactly', () => {
    expect(consumptionDeviationBp(3000n, 3000n)).toBe(0);
  });

  it('detects the 7% default alert threshold precisely', () => {
    // TZ §8: alert above 7% (700 bp).
    expect(consumptionDeviationBp(3210n, 3000n)).toBe(700); // exactly 7% — not yet an alert
    expect(consumptionDeviationBp(3211n, 3000n)).toBeGreaterThan(700);
  });

  it('returns null when either side is unknown, never a fabricated 0', () => {
    expect(consumptionDeviationBp(null, 3000n)).toBeNull();
    expect(consumptionDeviationBp(3000n, null)).toBeNull();
    expect(consumptionDeviationBp(3000n, 0n)).toBeNull();
  });
});

describe('sumBigInt / asBigInt', () => {
  it('sums while skipping nulls', () => {
    expect(sumBigInt([100n, null, 250n, undefined, 50n])).toBe(400n);
    expect(sumBigInt([])).toBe(0n);
  });

  it('normalises whatever a raw query returns', () => {
    expect(asBigInt(null)).toBe(0n);
    expect(asBigInt(undefined)).toBe(0n);
    expect(asBigInt(42)).toBe(42n);
    expect(asBigInt('42')).toBe(42n);
    expect(asBigInt(42n)).toBe(42n);
  });

  it('survives a sum wider than Number.MAX_SAFE_INTEGER', () => {
    const big = 9_007_199_254_740_991n;
    expect(sumBigInt([big, big])).toBe(18_014_398_509_481_982n);
  });
});
