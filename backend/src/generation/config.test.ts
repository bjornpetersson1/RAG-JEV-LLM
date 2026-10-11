import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_LIMITS, loadContextLimits } from './config.js';

describe('loadContextLimits', () => {
  it('defaults to 20 chunks and 60 000 characters', () => {
    expect(loadContextLimits({})).toEqual({ maxChunks: 20, maxContextChars: 60_000 });
    expect(DEFAULT_CONTEXT_LIMITS).toEqual(loadContextLimits({}));
  });

  it('reads both limits from the environment', () => {
    expect(
      loadContextLimits({ GENERATOR_MAX_CHUNKS: '5', GENERATOR_MAX_CONTEXT_CHARS: '9000' }),
    ).toEqual({ maxChunks: 5, maxContextChars: 9000 });
  });

  it.each([
    ['GENERATOR_MAX_CHUNKS', '0'],
    ['GENERATOR_MAX_CONTEXT_CHARS', 'many'],
  ])('rejects %s=%s with a message naming the variable', (key, value) => {
    expect(() => loadContextLimits({ [key]: value })).toThrow(
      `Invalid ${key} "${value}": expected a positive integer`,
    );
  });
});
