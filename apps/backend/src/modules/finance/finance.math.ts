/**
 * Finance arithmetic.
 *
 * Every function here is pure integer maths on BigInt. Nothing in this file
 * produces or consumes a JavaScript `number` for a monetary value, because a
 * double cannot represent 0.1 + 0.2, and a fleet's yearly profit is the last
 * place anyone wants to discover that (CLAUDE.md: «Pul UZS uchun BigInt
 * (tiyinda) — HECH QACHON float emas»).
 *
 * Units used throughout:
 *   money        — tiyin        (1 so'm = 100 tiyin)
 *   distance     — hectometres  (1 km = 10 hm; the schema stores km at 1 dp)
 *   volume       — centilitres  (1 L = 100 cl; the schema stores L at 2 dp)
 *   ratios       — basis points (1% = 100 bp; 100% = 10 000 bp)
 *   consumption  — cl per 100 km, i.e. L/100km × 100
 */

/** Divide and round half-away-from-zero, staying in BigInt the whole way. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('divRound: division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = (a + b / 2n) / b;
  return negative ? -quotient : quotient;
}

/**
 * A decimal string with a fixed scale → an integer in the smallest unit.
 * `"1250.50", 2 → 125050n`.  Parsed textually, never through `Number`.
 */
export function decimalStringToInt(value: string, scale: number): bigint {
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) throw new Error(`Not a decimal number: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > scale) {
    throw new Error(`More than ${scale} decimal places: ${value}`);
  }
  const scaled = BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  return sign ? -scaled : scaled;
}

/** The inverse of {@link decimalStringToInt}, for API responses. */
export function intToDecimalString(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Prisma hands `Decimal` columns back as a Decimal instance, and raw SQL sums
 * as a string. Both are exact decimal representations — unlike a double — so
 * they are converted through their string form.
 */
export function toScaledInt(
  value: { toFixed(digits: number): string } | string | null | undefined,
  scale: number,
): bigint {
  if (value === null || value === undefined) return 0n;
  const text = typeof value === 'string' ? value : value.toFixed(scale);
  return decimalStringToInt(text, scale);
}

/** Ratio of two integers as basis points (1% = 100 bp). 0 when the base is 0. */
export function ratioBp(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number(divRound(part * 10_000n, whole));
}

/**
 * Profit margin in basis points: profit ÷ revenue.
 * Negative when the trip lost money; 0 when there was no revenue to divide by.
 */
export const marginBp = (profit: bigint, revenue: bigint): number => ratioBp(profit, revenue);

/**
 * Cost per kilometre, in tiyin.
 *
 * `distanceHm` is hectometres, so the ×10 turns "tiyin per hectometre" into
 * "tiyin per kilometre". Returns null rather than 0 when the distance is
 * unknown — a 0 would read as "this route is free".
 */
export function perKm(amountTiyin: bigint, distanceHm: bigint): bigint | null {
  if (distanceHm <= 0n) return null;
  return divRound(amountTiyin * 10n, distanceHm);
}

/**
 * Fuel consumption in centilitres per 100 km (= L/100km × 100).
 *
 *   L/100km = litres × 100 ÷ km
 *           = (cl ÷ 100) × 100 ÷ (hm ÷ 10)
 *           = cl × 10 ÷ hm
 *   ×100 to keep two decimals as an integer → cl × 1000 ÷ hm
 */
export function consumptionCl100km(volumeCl: bigint, distanceHm: bigint): bigint | null {
  if (distanceHm <= 0n || volumeCl < 0n) return null;
  return divRound(volumeCl * 1000n, distanceHm);
}

/**
 * How far actual consumption sits from the vehicle's norm, in basis points.
 * Positive means the truck burned MORE than the norm — the direction that
 * costs money and the one the fuel-theft alert cares about (TZ §8, AI-4).
 */
export function consumptionDeviationBp(
  actualCl100km: bigint | null,
  normCl100km: bigint | null,
): number | null {
  if (actualCl100km === null || normCl100km === null || normCl100km <= 0n) return null;
  return ratioBp(actualCl100km - normCl100km, normCl100km);
}

/** Sums a column of BigInt-ish values from a raw query without touching Number. */
export function sumBigInt(values: Array<bigint | null | undefined>): bigint {
  return values.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);
}

/**
 * Raw SQL sums come back as bigint (when cast) or null when no rows matched.
 * Normalising here keeps every call site from repeating the `?? 0n`.
 */
export const asBigInt = (value: bigint | number | string | null | undefined): bigint => {
  if (value === null || value === undefined) return 0n;
  return typeof value === 'bigint' ? value : BigInt(value);
};
