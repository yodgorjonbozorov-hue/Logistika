/**
 * Integer money math. Every amount is tiyin (1 so'm = 100 tiyin) held as BigInt —
 * floats are forbidden (CLAUDE.md). Ratios are basis points (1% = 100 bp) so that
 * percentages stay exact integers too.
 *
 * Nothing here touches the database or the AI: TZ §6 numbers are produced by
 * plain deterministic code only.
 */

export const BP_SCALE = 10_000n;

/** Half-up division that rounds away from zero on a tie (−0.5 → −1, 0.5 → 1). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * absNumerator + absDenominator) / (2n * absDenominator);
  return negative ? -quotient : quotient;
}

/** part/whole as basis points (1% = 100). Returns null when whole is 0. */
export function ratioBp(part: bigint, whole: bigint): number | null {
  if (whole === 0n) return null;
  return Number(divRound(part * BP_SCALE, whole));
}

/** Applies a basis-point rate to an amount: 1 250 000 tiyin @ 1500 bp → 187 500. */
export function applyBp(amount: bigint, bp: bigint | number): bigint {
  return divRound(amount * BigInt(bp), BP_SCALE);
}

export const sumBigInt = (values: Iterable<bigint>): bigint => {
  let total = 0n;
  for (const value of values) total += value;
  return total;
};

/**
 * Prisma `Decimal | number | string | null` → integer scaled by 10^`scale`,
 * so distances (km) and volumes (litres) can join the same exact arithmetic.
 * Returns null for missing values; anything unparseable is treated as missing.
 */
export function toScaledInt(
  value: { toString(): string } | number | string | null | undefined,
  scale: number,
): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value : value.toString();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!match || (!match[2] && !match[3])) return null;
  const [, sign, whole = '', fraction = ''] = match;
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
  const dropped = fraction.slice(scale);
  let result = BigInt((whole || '0') + padded);
  // Round the truncated tail half-up so 12.345 at scale 2 becomes 12.35.
  if (dropped && Number(dropped[0]) >= 5) result += 1n;
  return sign === '-' ? -result : result;
}

/** Scaled integer → decimal string, e.g. (12345n, 2) → "123.45". */
export function fromScaledInt(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
