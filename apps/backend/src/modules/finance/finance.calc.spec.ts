import {
  calcFuelDeviation,
  calcTripFinance,
  costPerKm,
  depreciationForTrip,
  driverShareForTrip,
  roiBp,
} from './finance.calc';

describe('depreciationForTrip', () => {
  it('spreads the purchase price over the planned lifetime mileage (TZ §6)', () => {
    // 900 000 000 tiyin (9 mln so'm... 900 mln tiyin) over 1 000 000 km, 1 240.0 km trip
    expect(
      depreciationForTrip({ purchasePrice: 900_000_000_000n, plannedTotalKm: 1_000_000 }, 12_400n),
    ).toBe(1_116_000_000n);
  });

  it('rounds the tiyin half-up instead of truncating', () => {
    // 100 tiyin / 3 km × 1 km = 33.33 → 33
    expect(depreciationForTrip({ purchasePrice: 100n, plannedTotalKm: 3 }, 10n)).toBe(33n);
    // 100 tiyin / 8 km × 1 km = 12.5 → 13
    expect(depreciationForTrip({ purchasePrice: 100n, plannedTotalKm: 8 }, 10n)).toBe(13n);
  });

  it('is 0 when the vehicle card has no purchase price or plan, or the trip has no distance', () => {
    expect(depreciationForTrip({ purchasePrice: null, plannedTotalKm: 500_000 }, 1000n)).toBe(0n);
    expect(depreciationForTrip({ purchasePrice: 1_000n, plannedTotalKm: null }, 1000n)).toBe(0n);
    expect(depreciationForTrip({ purchasePrice: 1_000n, plannedTotalKm: 500_000 }, null)).toBe(0n);
    expect(depreciationForTrip(null, 1000n)).toBe(0n);
  });

  it('never divides by zero when the plan is 0 km', () => {
    expect(depreciationForTrip({ purchasePrice: 1_000n, plannedTotalKm: 0 }, 1000n)).toBe(0n);
  });
});

describe('driverShareForTrip', () => {
  it('PERCENT takes basis points of the agreed price', () => {
    // 15% of 12 500 000 tiyin
    expect(
      driverShareForTrip({ salaryType: 'PERCENT', salaryValue: 1500n }, 12_500_000n, 12_400n),
    ).toBe(1_875_000n);
  });

  it('PER_KM multiplies the rate by the distance', () => {
    // 800 tiyin/km × 1 240.0 km
    expect(driverShareForTrip({ salaryType: 'PER_KM', salaryValue: 800n }, 0n, 12_400n)).toBe(
      992_000n,
    );
  });

  it('PER_KM contributes nothing when the distance is unknown', () => {
    expect(driverShareForTrip({ salaryType: 'PER_KM', salaryValue: 800n }, 0n, null)).toBe(0n);
  });

  it('FIXED belongs to the month, not to the trip', () => {
    expect(
      driverShareForTrip({ salaryType: 'FIXED', salaryValue: 500_000_000n }, 12_500_000n, 12_400n),
    ).toBe(0n);
  });

  it('is 0 when the driver has no salary rule', () => {
    expect(driverShareForTrip(null, 12_500_000n, 12_400n)).toBe(0n);
    expect(driverShareForTrip({ salaryType: 'PERCENT', salaryValue: null }, 12_500_000n, 1n)).toBe(
      0n,
    );
  });
});

describe('calcTripFinance', () => {
  const base = {
    agreedPrice: 25_000_000_00n, // 25 mln so'm in tiyin
    distanceKmTenths: 12_400n, // 1 240.0 km
    vehicle: { purchasePrice: 900_000_000_000n, plannedTotalKm: 1_000_000 },
    driver: { salaryType: 'PERCENT' as const, salaryValue: 1000n },
  };

  it('computes profit = price − (expenses + driver share + depreciation)', () => {
    const result = calcTripFinance({
      ...base,
      expenses: [
        { category: 'FUEL', amount: 500_000_000n },
        { category: 'TOLL', amount: 30_000_000n },
        { category: 'CUSTOMS', amount: 20_000_000n },
      ],
    });

    expect(result.expensesTotal).toBe(550_000_000n);
    expect(result.driverShare).toBe(250_000_000n); // 10% of 2 500 000 000
    expect(result.depreciation).toBe(1_116_000_000n);
    expect(result.costTotal).toBe(1_916_000_000n);
    expect(result.profit).toBe(584_000_000n);
    expect(result.marginBp).toBe(2336); // 23.36%
    expect(result.profitPerKm).toBe(470_968n);
  });

  it('groups expenses per category for the W-4 finance tab', () => {
    const result = calcTripFinance({
      ...base,
      expenses: [
        { category: 'FUEL', amount: 100n },
        { category: 'FUEL', amount: 50n },
        { category: 'FINE', amount: 25n },
      ],
    });
    expect(result.expensesByCategory).toEqual({ FUEL: 150n, FINE: 25n });
  });

  it('lets a recorded SALARY expense replace the salary-rule estimate (no double count)', () => {
    const result = calcTripFinance({
      ...base,
      expenses: [
        { category: 'FUEL', amount: 500_000_000n },
        { category: 'SALARY', amount: 300_000_000n },
      ],
    });
    expect(result.driverShare).toBe(300_000_000n);
    expect(result.expensesTotal).toBe(500_000_000n); // salary is not counted twice
    expect(result.expensesByCategory.SALARY).toBeUndefined();
    expect(result.costTotal).toBe(500_000_000n + 300_000_000n + 1_116_000_000n);
  });

  it('reports a loss as a negative profit and margin', () => {
    const result = calcTripFinance({
      agreedPrice: 1_000_000n,
      distanceKmTenths: 1000n,
      expenses: [{ category: 'REPAIR', amount: 3_000_000n }],
    });
    expect(result.profit).toBe(-2_000_000n);
    expect(result.marginBp).toBe(-20_000);
    expect(result.profitPerKm).toBe(-20_000n);
  });

  it('leaves margin and per-km empty instead of dividing by zero', () => {
    const result = calcTripFinance({ agreedPrice: 0n, distanceKmTenths: null, expenses: [] });
    expect(result.marginBp).toBeNull();
    expect(result.profitPerKm).toBeNull();
    expect(result.profit).toBe(0n);
  });

  it('stays exact on amounts far beyond float precision', () => {
    const result = calcTripFinance({
      agreedPrice: 9_007_199_254_740_993n, // Number.MAX_SAFE_INTEGER + 2
      distanceKmTenths: null,
      expenses: [{ category: 'OTHER', amount: 1n }],
    });
    expect(result.profit).toBe(9_007_199_254_740_992n);
  });
});

describe('costPerKm', () => {
  it('divides period cost by period mileage (TZ §6)', () => {
    // (40 000 000 + 10 000 000) tiyin over 5 000.0 km
    expect(costPerKm(40_000_000n, 10_000_000n, 50_000n)).toBe(10_000n);
  });

  it('rounds half-up', () => {
    expect(costPerKm(5n, 0n, 20n)).toBe(3n); // 5 tiyin / 2 km = 2.5 → 3
  });

  it('returns null when nothing was driven', () => {
    expect(costPerKm(40_000_000n, 0n, 0n)).toBeNull();
    expect(costPerKm(40_000_000n, 0n, null)).toBeNull();
  });
});

describe('roiBp', () => {
  it('returns (income − cost) ÷ cost in basis points', () => {
    expect(roiBp(150n, 100n)).toBe(5000); // +50%
    expect(roiBp(50n, 100n)).toBe(-5000); // −50%
  });

  it('returns null when there is no cost base', () => {
    expect(roiBp(150n, 0n)).toBeNull();
  });
});

describe('calcFuelDeviation', () => {
  it('matches the TZ W-8 example row (1 240 km, 32 l/100km, 452 l)', () => {
    const result = calcFuelDeviation(12_400n, 3200n, 45_200n, 900_000n);
    expect(result.normCl).toBe(39_680n); // 396.80 l
    expect(result.deviationCl).toBe(5_520n); // +55.20 l
    expect(result.deviationBp).toBe(1391); // ~13.91% over the norm
    expect(result.lossTiyin).toBe(49_680_000n); // 55.2 l × 9 000 so'm
  });

  it('reports saving as a negative deviation', () => {
    const result = calcFuelDeviation(10_000n, 3000n, 28_000n, 900_000n);
    expect(result.deviationCl).toBe(-2_000n);
    expect(result.deviationBp).toBe(-667);
    expect(result.lossTiyin).toBe(-18_000_000n);
  });

  it('treats a missing norm or distance as zero norm — everything burnt is a deviation', () => {
    const result = calcFuelDeviation(null, 3000n, 10_000n, null);
    expect(result.normCl).toBe(0n);
    expect(result.deviationCl).toBe(10_000n);
    expect(result.deviationBp).toBeNull();
    expect(result.lossTiyin).toBeNull();
  });

  it('rounds the norm half-up at the centilitre', () => {
    // 1.5 km × 33.33 l/100km = 0.49995 l → 0.50 l
    expect(calcFuelDeviation(15n, 3333n, 0n, null).normCl).toBe(50n);
  });
});
