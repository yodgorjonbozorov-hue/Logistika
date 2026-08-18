/**
 * Money is tiyin (BigInt-as-string) on the wire; users see and type so'm.
 * All arithmetic stays in BigInt — floats are forbidden (CLAUDE.md).
 */

/** "419780000" tiyin → "4 197 800" (so'm, grouped). */
export function formatTiyin(tiyin: string | bigint | null | undefined): string {
  if (tiyin === null || tiyin === undefined || tiyin === '') return '—';
  const value = typeof tiyin === 'bigint' ? tiyin : BigInt(tiyin);
  const som = value / 100n;
  const sign = som < 0n ? '-' : '';
  const digits = (som < 0n ? -som : som).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped}`;
}

/** User input in so'm ("1250000" yoki "1 250 000") → tiyin string ("125000000"). */
export function somToTiyin(input: string): string | null {
  const cleaned = input.replace(/[\s\u00A0]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return (BigInt(cleaned) * 100n).toString();
}

/** Tiyin string → so'm string for form defaults. */
export function tiyinToSom(tiyin: string | null | undefined): string {
  if (!tiyin) return '';
  return (BigInt(tiyin) / 100n).toString();
}

export function sumTiyin(values: Array<string | null | undefined>): bigint {
  return values.reduce<bigint>((acc, v) => acc + (v ? BigInt(v) : 0n), 0n);
}

/**
 * Tiyin → millions of so'm with one decimal, e.g. "81240000000" → "812,4".
 * The decimal comma is the uz-latn/ru convention the design uses. Arithmetic
 * stays in BigInt: the tenths are computed before any string formatting.
 */
export function formatMillionsTiyin(tiyin: string | bigint | null | undefined): string {
  if (tiyin === null || tiyin === undefined || tiyin === '') return '—';
  const value = typeof tiyin === 'bigint' ? tiyin : BigInt(tiyin);
  const negative = value < 0n;
  const tenths = (negative ? -value : value) / 10_000_000n; // tiyin → 0.1 mln so'm
  const whole = (tenths / 10n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}${whole},${tenths % 10n}`;
}

/** Percentage of `part` in `total`, rounded, guarding a zero total. */
export function percentOf(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 1000n) / total) / 10;
}
