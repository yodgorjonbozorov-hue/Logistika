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
  });

  // M-8: the tiyin remainder used to be silently discarded on the way out and
  // fractional input rejected on the way in, so a screen total could never be
  // reconciled against the rows that produced it.
  it('keeps the tiyin remainder when formatting', () => {
    expect(formatTiyin('125050')).toBe(`1${NBSP}250,50`);
    expect(formatTiyin('1')).toBe('0,01');
    expect(formatTiyin('99')).toBe('0,99');
    expect(formatTiyin('101')).toBe('1,01');
    expect(formatTiyin(-125050n)).toBe(`-1${NBSP}250,50`);
  });

  it('accepts fractional som input without floating point', () => {
    expect(somToTiyin('1250.50')).toBe('125050');
    expect(somToTiyin('1250,50')).toBe('125050');
    expect(somToTiyin('1250.5')).toBe('125050');
    expect(somToTiyin('0.01')).toBe('1');
    expect(somToTiyin('1 250,05')).toBe('125005');
  });

  it('rejects input it cannot represent exactly', () => {
    expect(somToTiyin('1250.555')).toBeNull(); // sub-tiyin precision
    expect(somToTiyin('-5')).toBeNull();
    expect(somToTiyin('')).toBeNull();
    expect(somToTiyin('1.2.3')).toBeNull();
  });

  it('survives the classic floating point trap', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754; BigInt has no such answer.
    expect(somToTiyin('0.10')).toBe('10');
    expect(somToTiyin('0.20')).toBe('20');
    expect(sumTiyin([somToTiyin('0.10'), somToTiyin('0.20')])).toBe(30n);
    expect(formatTiyin(sumTiyin([somToTiyin('0.10'), somToTiyin('0.20')]))).toBe('0,30');
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
    // Round trip must be lossless, including the fractional part.
    expect(somToTiyin(tiyinToSom('125050'))).toBe('125050');
    expect(tiyinToSom('125050')).toBe('1250,50');
  });

  it('sums lists in BigInt', () => {
    expect(sumTiyin(['100', '250', null, undefined, '50'])).toBe(400n);
  });
});
