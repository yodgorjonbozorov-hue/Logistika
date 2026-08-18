import { describe, expect, it } from 'vitest';
import {
  formatMillionsTiyin,
  formatTiyin,
  percentOf,
  somToTiyin,
  sumTiyin,
  tiyinToSom,
} from './money';

const NBSP = ' '; // formatter groups digits with non-breaking spaces

describe('money utils (tiyin ↔ som, BigInt only)', () => {
  it('formats tiyin as grouped som', () => {
    expect(formatTiyin('419780000')).toBe(`4${NBSP}197${NBSP}800`);
    expect(formatTiyin('100')).toBe('1');
    expect(formatTiyin('0')).toBe('0');
    expect(formatTiyin(null)).toBe('—');
  });

  it('formats negative values', () => {
    expect(formatTiyin(-420000000n)).toBe(`-4${NBSP}200${NBSP}000`);
  });

  it('parses user som input to tiyin string', () => {
    expect(somToTiyin('1250000')).toBe('125000000');
    expect(somToTiyin('1 250 000')).toBe('125000000');
    expect(somToTiyin('abc')).toBeNull();
    expect(somToTiyin('12.5')).toBeNull();
  });

  it('handles amounts beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    expect(somToTiyin('99999999999999999')).toBe('9999999999999999900');
    expect(formatTiyin('9999999999999999900')).toBe(
      ['99', '999', '999', '999', '999', '999'].join(NBSP),
    );
  });

  it('round-trips form defaults', () => {
    expect(tiyinToSom('125000000')).toBe('1250000');
    expect(tiyinToSom(null)).toBe('');
  });

  it('sums lists in BigInt', () => {
    expect(sumTiyin(['100', '250', null, undefined, '50'])).toBe(400n);
  });
});

describe('formatMillionsTiyin', () => {
  it('renders millions of som with one decimal and a comma', () => {
    expect(formatMillionsTiyin('81240000000')).toBe('812,4');
    expect(formatMillionsTiyin('100000000')).toBe('1,0');
    expect(formatMillionsTiyin(0n)).toBe('0,0');
  });

  it('groups the whole part and keeps the sign', () => {
    expect(formatMillionsTiyin('123456700000000')).toBe(`1${NBSP}234${NBSP}567,0`);
    expect(formatMillionsTiyin(-81240000000n)).toBe('-812,4');
  });

  it('truncates rather than rounding up, so a total never overstates', () => {
    expect(formatMillionsTiyin('19900000')).toBe('0,1');
  });

  it('returns a dash for missing values', () => {
    expect(formatMillionsTiyin(null)).toBe('—');
    expect(formatMillionsTiyin('')).toBe('—');
  });
});

describe('percentOf', () => {
  it('computes a rounded share', () => {
    expect(percentOf(600n, 1000n)).toBe(60);
    expect(percentOf(1n, 3n)).toBeCloseTo(33.3, 1);
  });

  it('guards a zero total instead of dividing by it', () => {
    expect(percentOf(5n, 0n)).toBe(0);
  });
});
