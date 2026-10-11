import { readPositiveInteger } from '../env.js';

/** How much approved text the generator gets. */
export interface ContextLimits {
  maxChunks: number;
  /** The summed length of the chunks' texts, in characters. */
  maxContextChars: number;
}

// About 15k tokens of sources: room for the strongest sources without slowing the draft down much.
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = { maxChunks: 20, maxContextChars: 60_000 };

/** Reads `GENERATOR_MAX_CHUNKS` and `GENERATOR_MAX_CONTEXT_CHARS`. */
export function loadContextLimits(env: Record<string, string | undefined>): ContextLimits {
  return {
    maxChunks: readPositiveInteger(env, 'GENERATOR_MAX_CHUNKS', DEFAULT_CONTEXT_LIMITS.maxChunks),
    maxContextChars: readPositiveInteger(
      env,
      'GENERATOR_MAX_CONTEXT_CHARS',
      DEFAULT_CONTEXT_LIMITS.maxContextChars,
    ),
  };
}
