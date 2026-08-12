import {
  amortizationTiyin,
  costPerKmTiyin,
  divRound,
  driverShareTiyin,
  fuelDeviationPercent,
  fuelLossTiyin,
  fuelNormCl,
  roiPercent,
  toCentiliters,
  toKmTenths,
} from './finance.calc';

describe('divRound', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(divRound(-5n, 2n)).toBe(-3n); // -2.5 → -3
    expect(divRound(4n, 3n)).toBe(1n); // 1.33 → 1
    expect(divRound(5n, 3n)).toBe(2n); // 1.66 → 2
    expect(divRound(0n, 7n)).toBe(0n);
  });

  it('throws on zero denominator', () => {
    expect(() => divRound(1n, 0n)).toThrow();
  });
});

describe('scaled conversions', () => {
  it('converts km to tenths and liters to centiliters', () => {
    expect(toKmTenths(1240)).toBe(12400n);
    expect(toKmTenths(0.1)).toBe(1n);
    expect(toCentiliters(452.75)).toBe(45275n);
  });
});

describe('amortizationTiyin (TZ §6)', () => {
  // 800 mln so'm truck, 1 000 000 km planned life, 1 240 km trip:
  // 80_000_000_000 / 1_000_000 × 1240 = 99_200_000 tiyin (992 000 so'm).
  it('computes the trip share of vehicle cost', () => {
    expect(amortizationTiyin(80_000_000_000n, 1_000_000, 1240)).toBe(99_200_000n);
  });

  it('rounds the result', () => {
    // 1000 tiyin over 3 km lifetime, 1 km trip → 333.33 → 333
    expect(amortizationTiyin(1000n, 3, 1)).toBe(333n);
  });

  it('returns 0 without amortization inputs or distance', () => {
    expect(amortizationTiyin(null, 1_000_000, 500)).toBe(0n);
    expect(amortizationTiyin(1000n, null, 500)).toBe(0n);
    expect(amortizationTiyin(1000n, 0, 500)).toBe(0n);
    expect(amortizationTiyin(1000n, 1_000_000, 0)).toBe(0n);
  });
});

describe('driverShareTiyin', () => {
  it('PERCENT: basis points of the agreed price', () => {
    // 10% (1000 bp) of 5 000 000 so'm = 500 000 so'm
    expect(driverShareTiyin('PERCENT', 1000n, 500_000_000n, 900)).toBe(50_000_000n);
  });

  it('PERCENT: rounds half away from zero', () => {
    // 1 bp of 15000 tiyin = 1.5 → 2
    expect(driverShareTiyin('PERCENT', 1n, 15_000n, 1)).toBe(2n);
  });

  it('PER_KM: tiyin per km times distance (0.1 km precision)', () => {
    // 1500 so'm/km × 942.5 km = 1 413 750 so'm
    expect(driverShareTiyin('PER_KM', 150_000n, 0n, 942.5)).toBe(141_375_000n);
  });

  it('FIXED and missing settings contribute nothing to a single trip', () => {
    expect(driverShareTiyin('FIXED', 500_000_000n, 100n, 100)).toBe(0n);
    expect(driverShareTiyin(null, null, 100n, 100)).toBe(0n);
    expect(driverShareTiyin('PERCENT', null, 100n, 100)).toBe(0n);
  });
});

describe('costPerKmTiyin', () => {
  it('divides total cost by mileage', () => {
    // 4 960 000 so'm over 1240 km = 4000 so'm/km
    expect(costPerKmTiyin(496_000_000n, 1240)).toBe(400_000n);
  });

  it('handles fractional km and rounds', () => {
    expect(costPerKmTiyin(1000n, 3.3)).toBe(303n); // 1000/3.3 = 303.03
  });

  it('is null with zero mileage', () => {
    expect(costPerKmTiyin(1000n, 0)).toBeNull();
  });
});

describe('roiPercent', () => {
  it('computes percent with 2 decimals', () => {
    expect(roiPercent(130n, 100n)).toBe(30);
    expect(roiPercent(100n, 300n)).toBe(-66.67);
  });

  it('is null without a cost basis', () => {
    expect(roiPercent(100n, 0n)).toBeNull();
  });
});

describe('fuel formulas (TZ §6, W-8 example)', () => {
  // TZ W-8 row: 1240 km, norm 32 l/100km → 396.8 l; real 452 l → +55.2 l.
  it('computes norm liters from mileage', () => {
    expect(fuelNormCl(32, 1240)).toBe(39_680n); // 396.80 l
  });

  it('computes the loss from the diff and price', () => {
    const diff = toCentiliters(452) - fuelNormCl(32, 1240); // 5520 cl = 55.2 l
    expect(diff).toBe(5520n);
    // 55.2 l × 10 000 so'm/l = 552 000 so'm
    expect(fuelLossTiyin(diff, 1_000_000n)).toBe(55_200_000n);
  });

  it('negative diff yields a negative (saved) loss', () => {
    expect(fuelLossTiyin(-100n, 1_000_000n)).toBe(-1_000_000n);
  });

  it('computes deviation percent against the norm', () => {
    expect(fuelDeviationPercent(45_200n, 39_680n)).toBe(13.91);
    expect(fuelDeviationPercent(39_680n, 39_680n)).toBe(0);
    expect(fuelDeviationPercent(100n, 0n)).toBeNull();
  });

  it('norm is 0 for zero mileage or zero norm', () => {
    expect(fuelNormCl(0, 1240)).toBe(0n);
    expect(fuelNormCl(32, 0)).toBe(0n);
  });
});
