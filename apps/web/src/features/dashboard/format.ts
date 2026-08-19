/**
 * Display formatting for the finance dashboard.
 *
 * The API sends money as tiyin strings, distances and volumes as decimal
 * strings, and every ratio as an integer number of basis points. Nothing is
 * recomputed here — these turn a value the server already decided into text.
 * Doing the arithmetic in the browser is how two screens end up disagreeing
 * about the same month.
 */

const GROUP_SEPARATOR = '\u00A0'; // non-breaking, so a figure never wraps mid-number
const DECIMAL_SEPARATOR = ','; // uz-latn / ru convention, same as money.ts

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);

/**
 * A decimal string from the API → grouped display text. `"1300.5" → "1 300,5"`.
 *
 * Purely textual: `Number("9007199254740993")` would already be wrong.
 */
export function formatDecimal(value: string | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return '—';
  const [, sign, whole, fraction] = match;
  const text = `${sign}${group(whole!)}${fraction ? `${DECIMAL_SEPARATOR}${fraction}` : ''}`;
  return unit ? `${text} ${unit}` : text;
}

/**
 * Basis points → percentage text. `6696 → "66,96 %"`.
 *
 * `signed` prefixes a `+` on gains, which is what a month-over-month column
 * needs; a margin column does not want it.
 */
export function formatBp(
  bp: number | null | undefined,
  options: { signed?: boolean; decimals?: 0 | 1 | 2 } = {},
): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return '—';
  const { signed = false, decimals = 2 } = options;
  const negative = bp < 0;
  const absolute = Math.abs(bp);
  const divisor = 10 ** (2 - decimals);
  // Integer maths on an integer input: no 0.1 + 0.2 anywhere near a percentage.
  const scaled = Math.round(absolute / divisor);
  const whole = decimals === 0 ? scaled : Math.trunc(scaled / 10 ** decimals);
  const fraction = decimals === 0 ? '' : String(scaled % 10 ** decimals).padStart(decimals, '0');
  const sign = negative ? '-' : signed ? '+' : '';
  return `${sign}${group(String(whole))}${fraction ? `${DECIMAL_SEPARATOR}${fraction}` : ''} %`;
}

export type Tone = 'good' | 'bad' | 'neutral';

/** Green above zero, red below, neutral at zero or unknown. */
export function toneForValue(value: string | number | null | undefined): Tone {
  if (value === null || value === undefined || value === '') return 'neutral';
  const negative = typeof value === 'number' ? value < 0 : value.trim().startsWith('-');
  const zero = typeof value === 'number' ? value === 0 : /^-?0+(\.0+)?$/.test(value.trim());
  if (zero) return 'neutral';
  return negative ? 'bad' : 'good';
}

/**
 * Fuel consumption is the one figure where MORE is worse: a truck burning above
 * its norm is either badly maintained or losing fuel to a siphon (TZ §8).
 */
export function toneForDeviation(bp: number | null | undefined): Tone {
  if (bp === null || bp === undefined) return 'neutral';
  if (bp > 700) return 'bad';
  if (bp < 0) return 'good';
  return 'neutral';
}

export const TONE_CLASSES: Record<Tone, string> = {
  good: 'text-success',
  bad: 'text-danger',
  neutral: 'text-gray-700 dark:text-gray-200',
};

/** `"2026-08"` → `"08.2026"`, without pulling a date library in for it. */
export function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? `${match[2]}.${match[1]}` : month;
}

/**
 * Relative bar length as a percentage of the largest value in a series.
 *
 * Values arrive as tiyin strings that can exceed Number.MAX_SAFE_INTEGER, so
 * the ratio is taken in BigInt and only the final small percentage becomes a
 * number. A bar chart drawn from a rounded double would misreport the very
 * amounts it exists to compare.
 */
export function barPercent(value: string, max: string): number {
  const maxValue = BigInt(max);
  if (maxValue <= 0n) return 0;
  const raw = BigInt(value);
  const absolute = raw < 0n ? -raw : raw;
  const capped = absolute > maxValue ? maxValue : absolute;
  return Number((capped * 1000n) / maxValue) / 10;
}

/** Largest absolute value in a series of tiyin strings, as a tiyin string. */
export function maxAbs(values: string[]): string {
  let max = 0n;
  for (const value of values) {
    const parsed = BigInt(value);
    const absolute = parsed < 0n ? -parsed : parsed;
    if (absolute > max) max = absolute;
  }
  return max.toString();
}
