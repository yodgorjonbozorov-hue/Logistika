/**
 * The API keeps every measure as an integer so nothing is lost on the wire:
 * money in tiyin, percentages in basis points, distance in tenths of a km,
 * litres in hundredths. These helpers turn them into what a person reads.
 */

/** 4497 → "+44.97%" (basis points, one hundredth of a percent). */
export function formatBp(bp: number | null | undefined, options?: { signed?: boolean }): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return '—';
  const percent = bp / 100;
  const sign = options?.signed !== false && percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(percent % 1 === 0 ? 0 : 2)}%`;
}

/** 12400 → "1 240" (km, grouped, one decimal only when it matters). */
export function formatKm10(km10: number | null | undefined): string {
  if (km10 === null || km10 === undefined || !Number.isFinite(km10)) return '—';
  const km = km10 / 10;
  const text = km % 1 === 0 ? km.toFixed(0) : km.toFixed(1);
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 39680 → "396.8" (litres). */
export function formatLitersCenti(
  centi: number | null | undefined,
  options?: { signed?: boolean },
): string {
  if (centi === null || centi === undefined || !Number.isFinite(centi)) return '—';
  const liters = centi / 100;
  const sign = options?.signed && liters > 0 ? '+' : '';
  const text = Math.abs(liters) % 1 === 0 ? liters.toFixed(0) : liters.toFixed(1);
  return `${sign}${text}`;
}

/** `2026-08` → "08.2026" — the dashboard's month axis. */
export function formatMonth(month: string): string {
  const [year, monthPart] = month.split('-');
  return `${monthPart}.${year}`;
}
