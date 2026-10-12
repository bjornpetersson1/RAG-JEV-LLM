import { readPositiveInteger, type Env } from '../env.js';

// The same as RERANK_TOP_K's default, so both flows give the generator about as many chunks.
const DEFAULT_REFERENCE_TOP_K = 8;

/** `REFERENCE_TOP_K`: how many of the most similar chunks the reference RAG hands the generator. */
export function loadReferenceTopK(env: Env): number {
  return readPositiveInteger(env, 'REFERENCE_TOP_K', DEFAULT_REFERENCE_TOP_K);
}
