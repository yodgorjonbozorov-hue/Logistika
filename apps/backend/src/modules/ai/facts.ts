/**
 * The fact sheet: the ONLY thing the language model is ever shown.
 *
 * Every value here was computed by the finance core in integer arithmetic and
 * formatted here — the model receives finished strings and is asked to arrange
 * them into a sentence. It never sees a database, a query, a row, or anything
 * belonging to another company, because the analytics layer that produced these
 * facts was already bound to the caller's `companyId`.
 *
 * `allowedNumbers` is what makes the "AI must not invent figures" rule
 * enforceable rather than aspirational: every number the model is permitted to
 * write appears in it, and `verify.ts` rejects an answer containing anything
 * else.
 */
import { intToDecimalString } from '../finance/finance.math';

export interface Fact {
  /** Stable machine key — `revenue`, `topRoute.profit`, … */
  key: string;
  /** Display value, already formatted and already in the right unit. */
  value: string;
  /** `som`, `percent`, `km`, `litre`, `count`, `text`. */
  unit: FactUnit;
}

export type FactUnit = 'som' | 'percent' | 'km' | 'litre' | 'count' | 'text';

export interface FactSheet {
  /** Human-readable period, e.g. "2026-08-01 … 2026-08-31". */
  periodLabel: string;
  facts: Fact[];
  /** Canonical forms of every figure the model may use. */
  allowedNumbers: Set<string>;
  /**
   * Names the answer may quote — plates, route labels, driver names.
   *
   * They are listed separately because a plate like `01D777DD` contains digits:
   * an answer naming it would otherwise look, to the verifier, like an answer
   * quoting the figures 01 and 777.
   */
  textValues: string[];
  /** True when the period genuinely has nothing in it. */
  empty: boolean;
}

const GROUP = '\u00A0'; // non-breaking, so a figure never wraps mid-number

/** `"2300000000"` tiyin → `"23 000 000"` so'm. String maths only. */
export function tiyinToSom(tiyin: string | null | undefined): string | null {
  if (tiyin === null || tiyin === undefined || tiyin === '') return null;
  let value: bigint;
  try {
    value = BigInt(tiyin);
  } catch {
    return null;
  }
  const text = intToDecimalString(value, 2);
  const [whole = '0', fraction = '00'] = text.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  const sign = value < 0n ? '-' : '';
  // Whole so'm is the overwhelmingly common case and ",00" everywhere is noise.
  return fraction === '00' ? `${sign}${grouped}` : `${sign}${grouped},${fraction}`;
}

/**
 * A decimal string from the finance layer → the same convention as the money:
 * grouped thousands and a comma. `"1300.5"` → `"1 300,5"`.
 *
 * Without this an Uzbek sentence reads "200.00 l, 3 000 000 so'm" — two decimal
 * conventions three words apart, because the money is formatted here and the
 * litres came straight off the API.
 */
export function decimalToDisplay(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/** Basis points → `"66,96 %"`. Integer maths on an integer input. */
export function bpToPercent(bp: number | null | undefined, decimals: 0 | 1 | 2 = 1): string | null {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return null;
  const negative = bp < 0;
  const divisor = 10 ** (2 - decimals);
  const scaled = Math.round(Math.abs(bp) / divisor);
  const whole = decimals === 0 ? scaled : Math.trunc(scaled / 10 ** decimals);
  const fraction = decimals === 0 ? '' : String(scaled % 10 ** decimals).padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}${fraction ? `,${fraction}` : ''} %`;
}

/**
 * Canonical form of a number as it appears in text: digits only, with a decimal
 * part when there is one. `"23 000 000"`, `"23000000"` and `"23,000,000"` all
 * canonicalise to `"23000000"`, so a model that reformats a figure still passes
 * verification while a model that invents one does not.
 */
export function canonicalNumber(token: string): string {
  const cleaned = token
    .replace(/[\s\u00A0']/g, '')
    .replace(/,(\d{3})\b/g, '$1') // thousands separator
    .replace(',', '.'); // decimal comma
  const match = /^-?\d+(\.\d+)?$/.exec(cleaned);
  if (!match) return '';
  // Trailing zeros in the fraction are not a different number.
  const normalised = cleaned.includes('.')
    ? cleaned.replace(/0+$/, '').replace(/\.$/, '')
    : cleaned;
  return normalised.replace(/^-?0+(?=\d)/, (m) => (m.startsWith('-') ? '-' : ''));
}

/** Number-ish runs inside a formatted value ("66,96 %" → "66,96"). */
const NUMBER_IN_VALUE = /-?[\d\u00A0\s.,]*\d/g;

export class FactSheetBuilder {
  private readonly facts: Fact[] = [];
  private readonly allowed = new Set<string>();

  constructor(private readonly periodLabel: string) {}

  /** Adds a figure and registers every number inside it as permitted. */
  add(key: string, value: string | null | undefined, unit: FactUnit): this {
    if (value === null || value === undefined || value === '') return this;
    const display = unit === 'km' || unit === 'litre' ? (decimalToDisplay(value) ?? value) : value;
    this.facts.push({ key, value: display, unit });
    value = display;
    if (unit !== 'text') {
      for (const token of value.match(NUMBER_IN_VALUE) ?? []) {
        const canonical = canonicalNumber(token);
        if (canonical) this.allowed.add(canonical);
      }
    }
    return this;
  }

  addSom(key: string, tiyin: string | null | undefined): this {
    return this.add(key, tiyinToSom(tiyin), 'som');
  }

  addPercent(key: string, bp: number | null | undefined, decimals: 0 | 1 | 2 = 1): this {
    return this.add(key, bpToPercent(bp, decimals), 'percent');
  }

  addCount(key: string, count: number | null | undefined): this {
    if (count === null || count === undefined) return this;
    return this.add(key, String(count), 'count');
  }

  /** A name, plate or route label — never contributes an allowed number. */
  addText(key: string, text: string | null | undefined): this {
    return this.add(key, text ?? undefined, 'text');
  }

  build(): FactSheet {
    return {
      periodLabel: this.periodLabel,
      facts: this.facts,
      allowedNumbers: this.allowed,
      textValues: this.facts.filter((fact) => fact.unit === 'text').map((fact) => fact.value),
      // "No data" is decided by the NUMBERS in the facts, not by the whole
      // string: `margin` is "0,0 %", which is not itself a parsable number, and
      // testing the string would have called an entirely empty period non-empty.
      empty: this.facts.every(
        (fact) =>
          fact.unit === 'text' ||
          (fact.value.match(NUMBER_IN_VALUE) ?? []).every(
            (token) => canonicalNumber(token) === '0',
          ),
      ),
    };
  }
}

/** Renders the sheet as the compact block that goes into the model prompt. */
export function renderFacts(sheet: FactSheet): string {
  const unitSuffix: Record<FactUnit, string> = {
    som: " so'm",
    percent: '',
    km: ' km',
    litre: ' l',
    count: '',
    text: '',
  };
  return sheet.facts.map((fact) => `${fact.key}: ${fact.value}${unitSuffix[fact.unit]}`).join('\n');
}
