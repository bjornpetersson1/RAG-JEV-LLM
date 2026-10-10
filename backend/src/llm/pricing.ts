import type { LlmUsage } from './client.js';

interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Higher rates that apply when the prompt exceeds `thresholdTokens`. */
  longPrompt?: { thresholdTokens: number; inputPerMTok: number; outputPerMTok: number };
}

// Anthropic first-party list prices in USD per million tokens (as of 2026-10).
const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-6': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    longPrompt: { thresholdTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5 },
  },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

const TOKENS_PER_MILLION = 1_000_000;

/** Estimated cost in USD, or `undefined` for a model not in the price table. */
export function estimateCostUsd(model: string, usage: LlmUsage): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;

  const rates =
    price.longPrompt && usage.inputTokens > price.longPrompt.thresholdTokens
      ? price.longPrompt
      : price;
  return (
    (usage.inputTokens * rates.inputPerMTok + usage.outputTokens * rates.outputPerMTok) /
    TOKENS_PER_MILLION
  );
}
