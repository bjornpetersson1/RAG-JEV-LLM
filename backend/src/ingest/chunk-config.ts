import { readPositiveInteger } from '../env.js';

export interface ChunkConfig {
  /** No chunk's text is longer than this many characters. */
  maxChars: number;
  /** Pieces of a split shorter than this are merged with a neighbour when they fit. */
  minChars: number;
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = { maxChars: 2000, minChars: 200 };

/** Reads `CHUNK_MAX_CHARS` and `CHUNK_MIN_CHARS`; unset values use the defaults. */
export function loadChunkConfig(env: Record<string, string | undefined>): ChunkConfig {
  const maxChars = readPositiveInteger(env, 'CHUNK_MAX_CHARS', DEFAULT_CHUNK_CONFIG.maxChars);
  const minChars = readPositiveInteger(env, 'CHUNK_MIN_CHARS', DEFAULT_CHUNK_CONFIG.minChars);
  if (minChars >= maxChars) {
    throw new Error(
      `Invalid chunk settings: CHUNK_MIN_CHARS (${minChars}) must be less than CHUNK_MAX_CHARS (${maxChars})`,
    );
  }
  return { maxChars, minChars };
}
