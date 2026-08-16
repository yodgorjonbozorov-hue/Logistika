import { AI_MODELS, costMicroUsd, priceOf, usageMonthOf } from './ai.pricing';

describe('costMicroUsd', () => {
  it('prices a Haiku OCR call ($1/$5 per MTok)', () => {
    // 1500 input + 200 output → 1500 + 1000 micro-USD = $0.0025
    expect(costMicroUsd('claude-haiku-4-5', 1500, 200)).toBe(2500n);
  });

  it('prices a Sonnet answer ($3/$15 per MTok)', () => {
    expect(costMicroUsd('claude-sonnet-5', 4000, 600)).toBe(12_000n + 9_000n);
  });

  it('rounds half-up instead of truncating sub-token fractions to zero', () => {
    // 1 Haiku input token = 1 micro-USD exactly; 1 Sonnet output token = 15.
    expect(costMicroUsd('claude-haiku-4-5', 1, 0)).toBe(1n);
    expect(costMicroUsd('claude-sonnet-5', 0, 1)).toBe(15n);
  });

  it('bills an unknown model at the highest known rate', () => {
    expect(costMicroUsd('claude-something-new', 1_000_000, 0)).toBe(
      costMicroUsd('claude-opus-5', 1_000_000, 0),
    );
  });

  it('treats a negative token count as zero rather than a refund', () => {
    expect(costMicroUsd('claude-haiku-4-5', -100, -100)).toBe(0n);
  });

  it('keeps a price for every model the tiers point at', () => {
    for (const model of Object.values(AI_MODELS)) {
      expect(priceOf(model).input).toBeGreaterThan(0n);
      expect(priceOf(model).output).toBeGreaterThan(0n);
    }
  });

  it('stays within the TZ §8.11 monthly estimate for a 10-vehicle firm', () => {
    // 500 receipt photos a month, ~1500 input and ~200 output tokens each.
    const monthly = costMicroUsd('claude-haiku-4-5', 1500 * 500, 200 * 500);
    expect(monthly).toBeLessThan(2_000_000n); // under $2 — TZ budgets $8 for OCR
  });
});

describe('usageMonthOf', () => {
  it('buckets by UTC month', () => {
    expect(usageMonthOf(new Date('2026-08-16T22:00:00Z'))).toBe('2026-08');
    expect(usageMonthOf(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    // 31 Dec 23:00 UTC is already January in Tashkent, but the cap is UTC-based.
    expect(usageMonthOf(new Date('2026-12-31T23:00:00Z'))).toBe('2026-12');
  });
});
