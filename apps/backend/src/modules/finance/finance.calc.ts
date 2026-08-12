// TZ §6 formulas — deterministic integer arithmetic only (CLAUDE.md: money is
// BigInt tiyin, never float; the AI never computes these numbers).
//
// Fractional quantities are carried as scaled integers: distance in km-tenths
// (schema Decimal(9,1)) and fuel in centiliters (schema Decimal(8,2)).

import type { SalaryType } from '@prisma/client';

/** Integer division rounded half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('division by zero');
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  return sign * ((a * 2n + b) / (b * 2n));
}

/** Km (up to 1 decimal) → integer tenths of a km. */
export function toKmTenths(km: number): bigint {
  return BigInt(Math.round(km * 10));
}

/** Liters (up to 2 decimals) → integer centiliters. */
export function toCentiliters(liters: number): bigint {
  return BigInt(Math.round(liters * 100));
}

/**
 * Amortizatsiya = (Mashina narxi ÷ Rejadagi umumiy probeg) × Reys km.
 * Returns 0 when the vehicle has no amortization inputs.
 */
export function amortizationTiyin(
  purchasePriceTiyin: bigint | null,
  plannedTotalKm: number | null,
  tripKm: number,
): bigint {
  if (!purchasePriceTiyin || !plannedTotalKm || plannedTotalKm <= 0 || tripKm <= 0) return 0n;
  return divRound(purchasePriceTiyin * toKmTenths(tripKm), toKmTenths(plannedTotalKm));
}

/**
 * Driver share of one trip. PERCENT salaryValue is basis points of the agreed
 * price (1% = 100); PER_KM is tiyin per km; FIXED is a monthly salary and is
 * not attributed to a single trip (returns 0).
 */
export function driverShareTiyin(
  salaryType: SalaryType | null,
  salaryValue: bigint | null,
  agreedPriceTiyin: bigint,
  tripKm: number,
): bigint {
  if (!salaryType || !salaryValue) return 0n;
  switch (salaryType) {
    case 'PERCENT':
      return divRound(agreedPriceTiyin * salaryValue, 10_000n);
    case 'PER_KM':
      return divRound(salaryValue * toKmTenths(tripKm), 10n);
    case 'FIXED':
    default:
      return 0n;
  }
}

/** Tannarx/km = (barcha xarajat + amortizatsiya) ÷ probeg. Null when no mileage. */
export function costPerKmTiyin(totalCostTiyin: bigint, km: number): bigint | null {
  if (km <= 0) return null;
  return divRound(totalCostTiyin * 10n, toKmTenths(km));
}

/**
 * ROI = (kirim − xarajat) ÷ xarajat × 100, as a percent with 2 decimals.
 * Null when there is no cost basis.
 */
export function roiPercent(incomeTiyin: bigint, costTiyin: bigint): number | null {
  if (costTiyin <= 0n) return null;
  return Number(divRound((incomeTiyin - costTiyin) * 10_000n, costTiyin)) / 100;
}

/** Norma = (Probeg ÷ 100) × Norma_l/100km — centiliters. */
export function fuelNormCl(normPer100km: number, km: number): bigint {
  if (km <= 0 || normPer100km <= 0) return 0n;
  // kmTenths × normCl / 1000 = (km×10) × (norm×100) / (100×10)
  return divRound(toKmTenths(km) * toCentiliters(normPer100km), 1_000n);
}

/** Zarar = farq (cl) × 1 litr narxi (tiyin). Negative diff → negative "loss". */
export function fuelLossTiyin(diffCl: bigint, pricePerLiterTiyin: bigint): bigint {
  return divRound(diffCl * pricePerLiterTiyin, 100n);
}

/** Deviation in percent (2 decimals) of actual vs norm; null when norm is 0. */
export function fuelDeviationPercent(actualCl: bigint, normCl: bigint): number | null {
  if (normCl <= 0n) return null;
  return Number(divRound((actualCl - normCl) * 10_000n, normCl)) / 100;
}
