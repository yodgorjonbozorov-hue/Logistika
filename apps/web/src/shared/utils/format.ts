/**
 * Presentation helpers for the numbers the finance API returns:
 * money as tiyin strings, ratios as basis points, distances/volumes as decimals.
 */

/** 2336 bp → "23.36%"; null → "—". */
export function formatBp(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  return `${(bp / 100).toFixed(2)}%`;
}

/** "1240.0" → "1 240,0"; keeps the given number of decimals. */
export function formatDecimal(value: string | number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Tailwind text colour for a signed amount (tiyin string or bigint). */
export function amountTone(value: string | bigint | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return BigInt(value) < 0n ? 'text-danger' : 'text-success';
}

export function isNegative(value: string | bigint | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  return BigInt(value) < 0n;
}

/** Start/end of the current month as ISO strings — the default report window. */
export function currentMonthPeriod(now = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

/** <input type="date"> value → the ISO bounds of that day (start / end). */
export function dayBounds(value: string, end = false): string {
  const date = new Date(value);
  if (end) date.setUTCHours(23, 59, 59, 999);
  else date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/** ISO string → the "YYYY-MM-DD" an <input type="date"> expects. */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}
