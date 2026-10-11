import { describe, expect, it } from 'vitest';
import { NO_USAGE } from './client.js';
import { estimateCostUsd } from './pricing.js';

describe('estimateCostUsd', () => {
  it('prices cache writes at 1.25 and cache reads at 0.1 times the input rate', () => {
    // claude-opus-5-5: 4 USD per million input tokens, 20 USD per million output tokens.
    const cost = estimateCostUsd('claude-opus-5-5', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });

    expect(cost).toBeCloseTo(4 + 2 + 5 + 0.4);
  });

  it('counts cached tokens towards the long-prompt threshold', () => {
    // claude-haiku-5-5: 0.1/0.5 USD, or 0.5/2.5 USD above 100,000 prompt tokens.
    const cost = estimateCostUsd('claude-haiku-5-5', {
      inputTokens: 1_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 100_000,
    });

    expect(cost).toBeCloseTo((1_000 * 0.5 + 100_000 * 0.05) / 1_000_000);
  });

  it('is undefined for a model not in the price table', () => {
    expect(estimateCostUsd('unknown', { ...NO_USAGE, inputTokens: 1 })).toBeUndefined();
  });
});
