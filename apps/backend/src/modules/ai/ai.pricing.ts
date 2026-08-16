import { divRound } from '../../common/money';

/**
 * Model catalogue and cost arithmetic (TZ §8.11).
 *
 * Costs are counted in **micro-USD** (1 USD = 1_000_000) as BigInt: a single
 * Haiku call costs a small fraction of a cent, so cents would round every
 * request down to zero and the monthly cap would never trigger. Prices below
 * are USD per million tokens, expressed in micro-USD — `PRICES.input` of
 * 1_000_000 means $1.00 per 1M input tokens.
 */
export const MICRO_USD = 1_000_000n;
const PER_MILLION = 1_000_000n;

export interface ModelPrice {
  /** Micro-USD per million input tokens. */
  input: bigint;
  /** Micro-USD per million output tokens. */
  output: bigint;
}

/**
 * TZ §8.11 assigns the cheap model to mechanical work (OCR, pricing hints) and
 * the stronger one to reasoning (chat, anomaly explanations).
 */
export const AI_MODELS = {
  cheap: 'claude-haiku-4-5',
  smart: 'claude-sonnet-5',
} as const;

export type AiModelTier = keyof typeof AI_MODELS;

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-4-5': { input: 1_000_000n, output: 5_000_000n },
  'claude-sonnet-5': { input: 3_000_000n, output: 15_000_000n },
  'claude-opus-5': { input: 5_000_000n, output: 25_000_000n },
};

/** Price of the most expensive known model — used for unknown model ids. */
const FALLBACK_PRICE: ModelPrice = { input: 5_000_000n, output: 25_000_000n };

export function priceOf(model: string): ModelPrice {
  return PRICES[model] ?? FALLBACK_PRICE;
}

/**
 * Cost of one call in micro-USD, rounded half-up.
 * An unknown model is billed at the highest known rate on purpose: the cap must
 * never be under-counted just because the catalogue is out of date.
 */
export function costMicroUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): bigint {
  const price = priceOf(model);
  const input = divRound(BigInt(Math.max(0, promptTokens)) * price.input, PER_MILLION);
  const output = divRound(BigInt(Math.max(0, completionTokens)) * price.output, PER_MILLION);
  return input + output;
}

/** "2026-08" — the bucket a company's monthly AI usage is counted in (UTC). */
export function usageMonthOf(now: Date): string {
  const month = `${now.getUTCMonth() + 1}`.padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}`;
}
