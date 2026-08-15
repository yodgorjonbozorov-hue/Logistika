/**
 * TZ §6 formulas. Pure, deterministic, integer-only — the AI never takes part in
 * these numbers (CLAUDE.md: «Moliyaviy hisob-kitobni AI emas, oddiy kod bajaradi»).
 *
 * Units used throughout:
 *   money      — tiyin (BigInt)
 *   distance   — tenths of a km (BigInt), matching Decimal(9,1) in the schema
 *   volume     — centilitres, i.e. hundredths of a litre (BigInt)
 *   ratios     — basis points (number, 1% = 100 bp)
 */
import type { ExpenseCategory, SalaryType } from '@prisma/client';
import { applyBp, divRound, ratioBp } from '../../common/money';

export const KM_SCALE = 1; // Decimal(9,1) km
export const LITRE_SCALE = 2; // Decimal(8,2) litres

export interface ExpenseLine {
  category: ExpenseCategory;
  amount: bigint;
}

export interface DepreciationBasis {
  /** Vehicle purchase price in tiyin. */
  purchasePrice: bigint | null;
  /** Planned lifetime mileage in whole km. */
  plannedTotalKm: number | null;
}

export interface DriverSalaryRule {
  salaryType: SalaryType | null;
  /** FIXED → tiyin/month, PER_KM → tiyin/km, PERCENT → basis points. */
  salaryValue: bigint | null;
}

export interface TripFinanceInput {
  agreedPrice: bigint;
  expenses: ExpenseLine[];
  distanceKmTenths: bigint | null;
  vehicle?: DepreciationBasis | null;
  driver?: DriverSalaryRule | null;
}

export interface TripFinance {
  income: bigint;
  /** Recorded expenses per category; SALARY is reported through `driverShare`. */
  expensesByCategory: Partial<Record<ExpenseCategory, bigint>>;
  expensesTotal: bigint;
  driverShare: bigint;
  depreciation: bigint;
  costTotal: bigint;
  profit: bigint;
  /** profit ÷ income, in basis points; null when there is no income. */
  marginBp: number | null;
  /** Profit per km in tiyin; null when the distance is unknown. */
  profitPerKm: bigint | null;
  distanceKmTenths: bigint | null;
}

/**
 * Trip share of the vehicle's depreciation (TZ §6):
 *   (purchase price ÷ planned lifetime km) × trip km
 * Returns 0 when the vehicle card lacks the purchase price or the plan.
 */
export function depreciationForTrip(
  vehicle: DepreciationBasis | null | undefined,
  distanceKmTenths: bigint | null,
): bigint {
  if (!vehicle?.purchasePrice || !vehicle.plannedTotalKm || !distanceKmTenths) return 0n;
  if (vehicle.plannedTotalKm <= 0) return 0n;
  return divRound(vehicle.purchasePrice * distanceKmTenths, BigInt(vehicle.plannedTotalKm) * 10n);
}

/**
 * The driver's cut of one trip.
 * PERCENT → share of the agreed price, PER_KM → rate × distance.
 * FIXED is a monthly salary and belongs to the period, not to a single trip, so it
 * contributes 0 here and is counted in the period cost (cost-per-km) instead.
 */
export function driverShareForTrip(
  driver: DriverSalaryRule | null | undefined,
  agreedPrice: bigint,
  distanceKmTenths: bigint | null,
): bigint {
  if (!driver?.salaryType || driver.salaryValue === null || driver.salaryValue === undefined) {
    return 0n;
  }
  switch (driver.salaryType) {
    case 'PERCENT':
      return applyBp(agreedPrice, driver.salaryValue);
    case 'PER_KM':
      return distanceKmTenths ? divRound(driver.salaryValue * distanceKmTenths, 10n) : 0n;
    case 'FIXED':
    default:
      return 0n;
  }
}

/**
 * Net profit of one trip (TZ §6):
 *   profit = agreed price − (expenses + driver share + depreciation)
 *
 * Expenses booked under SALARY are the driver's actual payout, so when they exist
 * they REPLACE the salary-rule estimate — otherwise the same cost is counted twice.
 */
export function calcTripFinance(input: TripFinanceInput): TripFinance {
  const expensesByCategory: Partial<Record<ExpenseCategory, bigint>> = {};
  let expensesTotal = 0n;
  let salaryPaid = 0n;
  let hasSalaryExpense = false;

  for (const line of input.expenses) {
    if (line.category === 'SALARY') {
      hasSalaryExpense = true;
      salaryPaid += line.amount;
      continue;
    }
    expensesByCategory[line.category] = (expensesByCategory[line.category] ?? 0n) + line.amount;
    expensesTotal += line.amount;
  }

  const driverShare = hasSalaryExpense
    ? salaryPaid
    : driverShareForTrip(input.driver, input.agreedPrice, input.distanceKmTenths);
  const depreciation = depreciationForTrip(input.vehicle, input.distanceKmTenths);
  const costTotal = expensesTotal + driverShare + depreciation;
  const profit = input.agreedPrice - costTotal;

  return {
    income: input.agreedPrice,
    expensesByCategory,
    expensesTotal,
    driverShare,
    depreciation,
    costTotal,
    profit,
    marginBp: ratioBp(profit, input.agreedPrice),
    profitPerKm: input.distanceKmTenths ? divRound(profit * 10n, input.distanceKmTenths) : null,
    distanceKmTenths: input.distanceKmTenths,
  };
}

/**
 * Cost of one kilometre (TZ §6):
 *   (all period expenses + depreciation) ÷ period mileage
 * Returns null when nothing was driven in the period.
 */
export function costPerKm(
  expensesTotal: bigint,
  depreciation: bigint,
  distanceKmTenths: bigint | null,
): bigint | null {
  if (!distanceKmTenths || distanceKmTenths === 0n) return null;
  return divRound((expensesTotal + depreciation) * 10n, distanceKmTenths);
}

/**
 * Vehicle return on investment (TZ §6):
 *   (income − cost) ÷ cost × 100%, expressed in basis points.
 */
export function roiBp(income: bigint, cost: bigint): number | null {
  return ratioBp(income - cost, cost);
}

export interface FuelDeviation {
  /** Norm consumption for the mileage, in centilitres. */
  normCl: bigint;
  actualCl: bigint;
  /** actual − norm; positive means overrun. */
  deviationCl: bigint;
  /** Deviation share of the norm, in basis points; null when the norm is 0. */
  deviationBp: number | null;
  /** Money value of the deviation in tiyin; null when the price is unknown. */
  lossTiyin: bigint | null;
}

/**
 * Fuel norm and overrun (TZ §6):
 *   norm = (km ÷ 100) × norm_l_100km;  deviation = actual − norm;  loss = deviation × price
 */
export function calcFuelDeviation(
  distanceKmTenths: bigint | null,
  normPer100kmCl: bigint | null,
  actualCl: bigint,
  pricePerLitre: bigint | null,
): FuelDeviation {
  const normCl =
    distanceKmTenths && normPer100kmCl ? divRound(distanceKmTenths * normPer100kmCl, 1000n) : 0n;
  const deviationCl = actualCl - normCl;
  return {
    normCl,
    actualCl,
    deviationCl,
    deviationBp: ratioBp(deviationCl, normCl),
    lossTiyin: pricePerLitre === null ? null : divRound(deviationCl * pricePerLitre, 100n),
  };
}
