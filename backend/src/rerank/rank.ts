import type { ScoredChunk } from './types.js';

/** By descending score; equal scores keep their input (candidate) order. */
export function bestFirst(scored: readonly ScoredChunk[]): ScoredChunk[] {
  // Array.prototype.sort is stable.
  return [...scored].sort((a, b) => b.score - a.score);
}
