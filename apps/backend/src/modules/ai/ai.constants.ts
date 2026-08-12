/**
 * AI model selection (TZ §8.11): cheap model for OCR-style extraction, the
 * stronger one for chat/analysis. Model ids are env-overridable.
 * Prices are USD per million tokens — used only for the cost log and the
 * per-company monthly limit; money in the product domain stays BigInt tiyin.
 */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
};

const FALLBACK_PRICE = { input: 5, output: 25 };

/** Cost of one call in USD, rounded to 6 decimals (analytics precision). */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICES_USD_PER_MTOK[model] ?? FALLBACK_PRICE;
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export const AI_REQUEST_TIMEOUT_MS = 60_000;
export const AI_MAX_RETRIES = 2;
