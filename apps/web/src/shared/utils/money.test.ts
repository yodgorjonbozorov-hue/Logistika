import { describe, expect, it } from 'vitest';
import { formatTiyin, somToTiyin, sumTiyin, tiyinToSom } from './money';

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
