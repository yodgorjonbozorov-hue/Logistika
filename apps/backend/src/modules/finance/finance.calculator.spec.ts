import { ExpenseCategory, SalaryType } from 'shared';
import {
  amortization,
  costPerKm,
  divideRounded,
  driverShare,
  fuelDeviation,
  roiBp,
  toKm10,
  tripPnl,
} from './finance.calculator';

/**
 * The finance module carries the highest coverage in the project (CLAUDE.md):
 * every formula from TZ §6, plus the rounding and boundary cases that decide
 * whether a fleet owner trusts the numbers.
 */
describe('divideRounded', () => {
  it('rounds halves away from zero', () => {
    expect(divideRounded(5n, 2n)).toBe(3n);
    expect(divideRounded(-5n, 2n)).toBe(-3n);
    expect(divideRounded(4n, 3n)).toBe(1n);
    expect(divideRounded(5n, 3n)).toBe(2n);
  });

  it('treats a zero denominator as unknown, not as a crash', () => {
    expect(divideRounded(100n, 0n)).toBe(0n);
  });

  it('keeps full precision on sums far beyond Number.MAX_SAFE_INTEGER', () => {
    // 92 233 720 368 547 758.07 so'm in tiyin — past the float barrier.
    const huge = 9_223_372_036_854_775_807n;
    expect(divideRounded(huge * 3n, 3n)).toBe(huge);
  });
});

describe('toKm10', () => {
  it('carries one decimal without floats', () => {
    expect(toKm10(278.4)).toBe(2784);
    expect(toKm10('278.44')).toBe(2784);
    expect(toKm10('0.05')).toBe(1);
  });

  it('reads missing or nonsensical distances as zero', () => {
    expect(toKm10(null)).toBe(0);
    expect(toKm10(undefined)).toBe(0);
    expect(toKm10('')).toBe(0);
    expect(toKm10(-120)).toBe(0);
    expect(toKm10(Number.NaN)).toBe(0);
  });
});

describe('amortization — (price ÷ planned km) × trip km', () => {
  it('charges the trip its share of the vehicle', () => {
    // 900 000 000 so'm over 1 000 000 km → 900 so'm/km × 310 km = 279 000 so'm
    expect(
      amortization({ purchasePrice: 90_000_000_000n, plannedTotalKm: 1_000_000, km10: 3100 }),
    ).toBe(27_900_000n);
  });

  it('multiplies before dividing, so the per-km rate is not rounded twice', () => {
    // 100 tiyin over 3 km would round to 33 tiyin/km → 99 over 3 km; the exact
    // share is 100.
    expect(amortization({ purchasePrice: 100n, plannedTotalKm: 3, km10: 30 })).toBe(100n);
  });

  it('is zero while the fleet has not declared price or lifetime', () => {
    expect(amortization({ purchasePrice: null, plannedTotalKm: 1_000_000, km10: 3100 })).toBe(0n);
    expect(amortization({ purchasePrice: 90_000_000_000n, plannedTotalKm: null, km10: 3100 })).toBe(
      0n,
    );
    expect(amortization({ purchasePrice: 90_000_000_000n, plannedTotalKm: 0, km10: 3100 })).toBe(
      0n,
    );
    expect(
      amortization({ purchasePrice: 90_000_000_000n, plannedTotalKm: 1_000_000, km10: 0 }),
    ).toBe(0n);
  });
});

describe('driverShare', () => {
  const base = { km10: 3100, revenue: 1_250_000_000n };

  it('pays a fixed contract the flat amount, whatever the trip', () => {
    expect(driverShare({ ...base, salaryType: SalaryType.FIXED, salaryValue: 65_000_000n })).toBe(
      65_000_000n,
    );
  });

  it('pays a per-km contract by distance', () => {
    // 900 so'm/km × 310 km
    expect(driverShare({ ...base, salaryType: SalaryType.PER_KM, salaryValue: 90_000n })).toBe(
      27_900_000n,
    );
  });

  it('pays a percent contract from revenue, reading basis points', () => {
    // 12% of 12 500 000 so'm
    expect(driverShare({ ...base, salaryType: SalaryType.PERCENT, salaryValue: 1200n })).toBe(
      150_000_000n,
    );
  });

  it('is zero without a contract', () => {
    expect(driverShare({ ...base, salaryType: null, salaryValue: 1200n })).toBe(0n);
    expect(driverShare({ ...base, salaryType: SalaryType.PERCENT, salaryValue: null })).toBe(0n);
    expect(driverShare({ ...base, salaryType: SalaryType.PERCENT, salaryValue: 0n })).toBe(0n);
  });
});

describe('tripPnl', () => {
  const vehicle = { purchasePrice: 90_000_000_000n, plannedTotalKm: 1_000_000 };
  const driver = { salaryType: SalaryType.PERCENT, salaryValue: 1000n };

  function pnl(overrides: Partial<Parameters<typeof tripPnl>[0]> = {}) {
    return tripPnl({
      agreedPrice: 1_250_000_000n,
      paidIncome: null,
      expenses: [
        { category: ExpenseCategory.FUEL, amount: 480_000_000n },
        { category: ExpenseCategory.TOLL, amount: 35_000_000n },
        { category: ExpenseCategory.FUEL, amount: 20_000_000n },
      ],
      driverAdvance: 20_000_000n,
      driver,
      vehicle,
      km10: 3100,
      ...overrides,
    });
  }

  it('nets revenue against expenses, driver share and amortization', () => {
    const result = pnl();
    expect(result.revenue).toBe(1_250_000_000n);
    expect(result.expenseTotal).toBe(535_000_000n);
    expect(result.driverShare).toBe(125_000_000n); // 10% of revenue
    expect(result.amortization).toBe(27_900_000n);
    expect(result.netProfit).toBe(562_100_000n);
  });

  it('groups expenses by category, largest first', () => {
    expect(pnl().expensesByCategory).toEqual([
      { category: ExpenseCategory.FUEL, amount: 500_000_000n },
      { category: ExpenseCategory.TOLL, amount: 35_000_000n },
    ]);
  });

  it('prefers money actually received over the agreed price', () => {
    expect(pnl({ paidIncome: 1_400_000_000n }).revenue).toBe(1_400_000_000n);
    // A percent-paid driver is paid from what the client really paid.
    expect(pnl({ paidIncome: 1_400_000_000n }).driverShare).toBe(140_000_000n);
  });

  it('falls back to the agreed price when nothing has been paid yet', () => {
    expect(pnl({ paidIncome: 0n }).revenue).toBe(1_250_000_000n);
  });

  it('reports a loss as a negative profit, never as zero', () => {
    const result = pnl({
      expenses: [{ category: ExpenseCategory.REPAIR, amount: 2_000_000_000n }],
    });
    expect(result.netProfit).toBeLessThan(0n);
    expect(result.marginBp).toBeLessThan(0);
  });

  it('survives a trip with no revenue, no distance and no references', () => {
    const result = tripPnl({
      agreedPrice: 0n,
      paidIncome: null,
      expenses: [],
      driverAdvance: 0n,
      driver: null,
      vehicle: null,
      km10: 0,
    });
    expect(result).toMatchObject({
      revenue: 0n,
      expenseTotal: 0n,
      driverShare: 0n,
      amortization: 0n,
      netProfit: 0n,
      marginBp: 0,
      costPerKm: 0n,
    });
  });

  it('states what the driver is still owed after the advance', () => {
    expect(pnl().driverBalance).toBe(105_000_000n); // 125 000 000 − 20 000 000
    expect(pnl({ driverAdvance: 200_000_000n }).driverBalance).toBe(-75_000_000n);
  });

  it('reports margin in basis points', () => {
    // 562 100 000 / 1 250 000 000 = 44.968%
    expect(pnl().marginBp).toBe(4497);
  });
});

describe('costPerKm', () => {
  it('divides total cost by distance', () => {
    expect(costPerKm({ totalCost: 68_800_000n, km10: 3100 })).toBe(221_935n);
  });

  it('is zero without distance, rather than dividing by zero', () => {
    expect(costPerKm({ totalCost: 68_800_000n, km10: 0 })).toBe(0n);
  });
});

describe('roiBp', () => {
  it('measures return against cost', () => {
    expect(roiBp({ revenue: 1_500n, cost: 1_000n })).toBe(5000); // +50%
    expect(roiBp({ revenue: 800n, cost: 1_000n })).toBe(-2000); // −20%
  });

  it('is zero when nothing was spent — no infinite return', () => {
    expect(roiBp({ revenue: 1_000n, cost: 0n })).toBe(0);
  });
});

describe('fuelDeviation — the W-8 signal', () => {
  it('matches the TZ example: 1 240 km, 32 l/100km, 452 l filled', () => {
    const result = fuelDeviation({
      km10: 12_400,
      normPer100kmCenti: 3200,
      actualLitersCenti: 45_200,
      pricePerLiter: 1_000_000n, // 10 000 so'm/l
    });
    expect(result.normLitersCenti).toBe(39_680); // 396.80 l
    expect(result.diffLitersCenti).toBe(5520); // +55.20 l
    expect(result.lossTiyin).toBe(55_200_000n); // 552 000 so'm
    expect(result.diffBp).toBe(1391); // +13.91%
  });

  it('counts an underrun as a negative difference and no loss', () => {
    const result = fuelDeviation({
      km10: 1000,
      normPer100kmCenti: 3000,
      actualLitersCenti: 2500,
      pricePerLiter: 1_000_000n,
    });
    expect(result.diffLitersCenti).toBe(-500);
    expect(result.lossTiyin).toBe(0n);
  });

  it('still reports the litre difference when the price is unknown', () => {
    const result = fuelDeviation({
      km10: 1000,
      normPer100kmCenti: 3000,
      actualLitersCenti: 3500,
      pricePerLiter: null,
    });
    expect(result.diffLitersCenti).toBe(500);
    expect(result.lossTiyin).toBe(0n);
  });

  it('reports no norm — and so no signal — when the vehicle has none', () => {
    const result = fuelDeviation({
      km10: 1000,
      normPer100kmCenti: 0,
      actualLitersCenti: 3500,
      pricePerLiter: 1_000_000n,
    });
    expect(result.normLitersCenti).toBe(0);
    expect(result.diffBp).toBe(0);
  });
});
