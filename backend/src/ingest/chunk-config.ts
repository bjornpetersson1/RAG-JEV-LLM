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

function readPositiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const value = env[key]?.trim();
  if (!value) return fallback;
  // Only plain digits: Number() would also accept "2e3", "0x7D0" or "2000.0".
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${key} "${value}": expected a positive integer`);
  }
  return parsed;
}
