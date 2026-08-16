import { describe, expect, it } from 'vitest';
import { microUsdToDollars } from './settings';

describe('microUsdToDollars', () => {
  it('shows a fraction of a cent without leaving integers', () => {
    expect(microUsdToDollars('1250000')).toBe('1.25');
    expect(microUsdToDollars('2500')).toBe('0.00'); // a quarter of a cent
    expect(microUsdToDollars('2500', 4)).toBe('0.0025');
  });

  it('rounds nothing away — it truncates what it shows', () => {
    expect(microUsdToDollars('50000000', 0)).toBe('50');
    expect(microUsdToDollars('49999999', 0)).toBe('49');
    expect(microUsdToDollars('49999999')).toBe('49.99');
  });

  it('handles zero and a bare cap', () => {
    expect(microUsdToDollars('0')).toBe('0.00');
    expect(microUsdToDollars('0', 0)).toBe('0');
  });
});
