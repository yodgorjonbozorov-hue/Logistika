/**
 * Money is tiyin (BigInt-as-string) on the wire; users see and type so'm.
 * All arithmetic stays in BigInt — floats are forbidden (CLAUDE.md).
 */

const GROUP_SEPARATOR = '\u00A0'; // non-breaking space, so amounts never wrap
const DECIMAL_SEPARATOR = ','; // uz-latn / ru convention

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);

/**
 * "419780000" tiyin → "4 197 800"; "125050" → "1 250,50".
 *
 * The old implementation was `value / 100n` and nothing else, which silently
 * DISCARDED the tiyin remainder (M-8): 1 250,50 so'm rendered as "1 250", so a
 * reconciled total never matched the sum of the rows on screen. Whole-so'm
 * amounts still render without a decimal part, because in practice almost every
 * amount is whole and ",00" everywhere is just noise.
 */
export function formatTiyin(tiyin: string | bigint | null | undefined): string {
  if (tiyin === null || tiyin === undefined || tiyin === '') return '—';
  const value = typeof tiyin === 'bigint' ? tiyin : BigInt(tiyin);
  const negative = value < 0n;
  const absolute = negative ? -value : value;

  const som = absolute / 100n;
  const tiyinPart = absolute % 100n;
  const sign = negative ? '-' : '';
  const fraction =
    tiyinPart === 0n ? '' : `${DECIMAL_SEPARATOR}${tiyinPart.toString().padStart(2, '0')}`;

  return `${sign}${group(som.toString())}${fraction}`;
}

/**
 * User input in so'm ("1 250 000", "1250,50", "1250.5") → tiyin string.
 * Returns null when the input is not a usable amount.
 *
 * Fractional input used to be rejected outright, which made it impossible to
 * enter an amount the system is perfectly capable of storing.
 */
export function somToTiyin(input: string): string | null {
  const cleaned = input.replace(/[\s\u00A0]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole = '0', fraction = ''] = cleaned.split('.');
  // String padding, never Number(): 0.1 + 0.2 has no place near money.
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')).toString();
}

/** Tiyin string → so'm string for form defaults. */
export function tiyinToSom(tiyin: string | null | undefined): string {
  if (!tiyin) return '';
  const value = BigInt(tiyin);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const tiyinPart = absolute % 100n;
  const som = `${absolute / 100n}${
    tiyinPart === 0n ? '' : `${DECIMAL_SEPARATOR}${tiyinPart.toString().padStart(2, '0')}`
  }`;
  return negative ? `-${som}` : som;
}

export function sumTiyin(values: Array<string | null | undefined>): bigint {
  return values.reduce<bigint>((acc, v) => acc + (v ? BigInt(v) : 0n), 0n);
}
