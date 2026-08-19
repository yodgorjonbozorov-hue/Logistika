import { ExpenseCategory, SalaryType } from 'shared';

/**
 * TZ §6 — the money formulas. Deliberately dependency-free and deterministic:
 * plain code decides every figure, never the AI (CLAUDE.md), and every amount
 * is BigInt tiyin. Distances arrive as tenths of a kilometre (`km10`) so a
 * fractional trip length never becomes a float.
 */

/** Basis points: 1% = 100, so percentages stay integers too. */
export type BasisPoints = number;

export const PERCENT = 100;

/** Rounds a rational number to the nearest whole tiyin, halves away from zero. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const result = (a + b / 2n) / b;
  return negative ? -result : result;
}

/** Kilometres carried as tenths — `2784` means 278.4 km. */
export function toKm10(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const km = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(km) || km < 0) return 0;
  return Math.round(km * 10);
}

export interface AmortizationInput {
  /** Vehicle purchase price in tiyin. */
  purchasePrice: bigint | null;
  /** Planned lifetime mileage in whole kilometres. */
  plannedTotalKm: number | null;
  km10: number;
}

/**
 * Amortizatsiya = (Mashina narxi ÷ Rejadagi umumiy probeg) × Reys km
 *
 * Multiplication happens before division so the per-kilometre rate is never
 * rounded twice. Missing inputs mean "unknown", which is 0 — a trip is never
 * charged for depreciation the fleet has not declared.
 */
export function amortization({ purchasePrice, plannedTotalKm, km10 }: AmortizationInput): bigint {
  if (!purchasePrice || !plannedTotalKm || plannedTotalKm <= 0 || km10 <= 0) return 0n;
  return divideRounded(purchasePrice * BigInt(km10), BigInt(plannedTotalKm) * 10n);
}

export interface DriverShareInput {
  salaryType: SalaryType | null;
  /** FIXED → tiyin per trip, PER_KM → tiyin per km, PERCENT → basis points. */
  salaryValue: bigint | null;
  km10: number;
  /** Trip revenue in tiyin — the base for PERCENT contracts. */
  revenue: bigint;
}

/** The driver's cut of one trip, by contract type (TZ §5 drivers.salary_type). */
export function driverShare({ salaryType, salaryValue, km10, revenue }: DriverShareInput): bigint {
  if (!salaryType || salaryValue === null || salaryValue <= 0n) return 0n;
  switch (salaryType) {
    case SalaryType.FIXED:
      return salaryValue;
    case SalaryType.PER_KM:
      return divideRounded(salaryValue * BigInt(km10), 10n);
    case SalaryType.PERCENT:
      return divideRounded(revenue * salaryValue, BigInt(PERCENT * 100));
    default:
      return 0n;
  }
}

export interface TripPnlInput {
  agreedPrice: bigint;
  /** Recorded incomes for the trip; when present they replace the agreed price. */
  paidIncome: bigint | null;
  expenses: Array<{ category: ExpenseCategory; amount: bigint }>;
  driverAdvance: bigint;
  driver: Omit<DriverShareInput, 'revenue' | 'km10'> | null;
  vehicle: Omit<AmortizationInput, 'km10'> | null;
  km10: number;
}

export interface TripPnl {
  revenue: bigint;
  expensesByCategory: Array<{ category: ExpenseCategory; amount: bigint }>;
  expenseTotal: bigint;
  driverShare: bigint;
  amortization: bigint;
  /** Revenue − (expenses + driver share + amortization). */
  netProfit: bigint;
  /** Net profit as a share of revenue, in basis points. */
  marginBp: BasisPoints;
  costPerKm: bigint;
  /** What the driver still has coming after the advance (may be negative). */
  driverBalance: bigint;
}

/**
 * Foyda = Kelishilgan narx − (yoqilg'i + yo'l boji + bojxona + haydovchi
 *         ulushi + shtraf + boshqa xarajatlar + amortizatsiya)
 *
 * Expenses arrive already categorised, so the formula sums whatever categories
 * the trip actually carries rather than a fixed list.
 */
export function tripPnl(input: TripPnlInput): TripPnl {
  const revenue =
    input.paidIncome !== null && input.paidIncome > 0n ? input.paidIncome : input.agreedPrice;

  const byCategory = new Map<ExpenseCategory, bigint>();
  for (const expense of input.expenses) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0n) + expense.amount);
  }
  const expensesByCategory = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const expenseTotal = expensesByCategory.reduce((sum, item) => sum + item.amount, 0n);

  const share = input.driver ? driverShare({ ...input.driver, km10: input.km10, revenue }) : 0n;
  const depreciation = input.vehicle ? amortization({ ...input.vehicle, km10: input.km10 }) : 0n;

  const totalCost = expenseTotal + share + depreciation;
  const netProfit = revenue - totalCost;

  return {
    revenue,
    expensesByCategory,
    expenseTotal,
    driverShare: share,
    amortization: depreciation,
    netProfit,
    marginBp: revenue === 0n ? 0 : Number(divideRounded(netProfit * 10_000n, revenue)),
    costPerKm: costPerKm({ totalCost, km10: input.km10 }),
    driverBalance: share - input.driverAdvance,
  };
}

/** Tannarx/km = (Barcha xarajat + amortizatsiya) ÷ Probeg */
export function costPerKm({ totalCost, km10 }: { totalCost: bigint; km10: number }): bigint {
  if (km10 <= 0) return 0n;
  return divideRounded(totalCost * 10n, BigInt(km10));
}

/** ROI = (Kirim − Xarajat) ÷ Xarajat × 100%, in basis points. */
export function roiBp({ revenue, cost }: { revenue: bigint; cost: bigint }): BasisPoints {
  if (cost <= 0n) return 0;
  return Number(divideRounded((revenue - cost) * 10_000n, cost));
}

export interface FuelDeviationInput {
  km10: number;
  /** Litres per 100 km, carried as hundredths (3160 = 31.60 l). */
  normPer100kmCenti: number;
  /** Litres actually put in, as hundredths of a litre. */
  actualLitersCenti: number;
  /** Average price per litre in tiyin. */
  pricePerLiter: bigint | null;
}

export interface FuelDeviation {
  normLitersCenti: number;
  actualLitersCenti: number;
  /** Positive = burned more than the norm allows. */
  diffLitersCenti: number;
  /** Overrun as a share of the norm, in basis points. */
  diffBp: BasisPoints;
  /** Money value of the overrun; 0 when the vehicle stayed within the norm. */
  lossTiyin: bigint;
}

/**
 * Norma = (Probeg ÷ 100) × Norma_l_100km;  Farq = Real − Norma;
 * Zarar = Farq × Yoqilg'i narxi   (TZ §6, W-8 killer feature)
 */
export function fuelDeviation({
  km10,
  normPer100kmCenti,
  actualLitersCenti,
  pricePerLiter,
}: FuelDeviationInput): FuelDeviation {
  const normLitersCenti =
    km10 <= 0 || normPer100kmCenti <= 0 ? 0 : Math.round((km10 * normPer100kmCenti) / 1000);
  const diffLitersCenti = actualLitersCenti - normLitersCenti;
  const loss =
    diffLitersCenti > 0 && pricePerLiter && pricePerLiter > 0n
      ? divideRounded(BigInt(diffLitersCenti) * pricePerLiter, 100n)
      : 0n;

  return {
    normLitersCenti,
    actualLitersCenti,
    diffLitersCenti,
    diffBp: normLitersCenti <= 0 ? 0 : Math.round((diffLitersCenti * 10_000) / normLitersCenti),
    lossTiyin: loss,
  };
}
