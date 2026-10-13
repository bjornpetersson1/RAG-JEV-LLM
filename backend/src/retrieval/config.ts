import { readOneOf, readPositiveInteger, readShare, type Env } from '../env.js';

/** Where candidates come from: tag search (E4), bge-m3 hybrid search (E8-4), or both fused. */
export const RETRIEVERS = ['tags', 'bge', 'both'] as const;
export type RetrieverName = (typeof RETRIEVERS)[number];

export interface RetrievalConfig {
  retriever: RetrieverName;
  /** `RETRIEVE_CANDIDATES`: how many candidates `bge` and `both` pass on; `tags` keeps `MAX_CANDIDATES`. */
  candidates: number;
  /** `RRF_K`: reciprocal rank fusion adds `weight / (k + rank)` per list. */
  rrfK: number;
  /** Each list's weight in the fusion, 0–1. */
  weights: { dense: number; lexical: number; tags: number };
}

/**
 * Reads `RETRIEVER` (`tags` by default), `RETRIEVE_CANDIDATES` (20, from E7-4's sweep), `RRF_K` (60) and
 * `RRF_WEIGHT_DENSE` / `RRF_WEIGHT_LEXICAL` / `RRF_WEIGHT_TAGS` (1 each).
 */
export function loadRetrievalConfig(env: Env): RetrievalConfig {
  return {
    retriever: readOneOf(env, 'RETRIEVER', RETRIEVERS, 'tags'),
    candidates: readPositiveInteger(env, 'RETRIEVE_CANDIDATES', 20),
    rrfK: readPositiveInteger(env, 'RRF_K', 60),
    weights: {
      dense: readShare(env, 'RRF_WEIGHT_DENSE', 1),
      lexical: readShare(env, 'RRF_WEIGHT_LEXICAL', 1),
      tags: readShare(env, 'RRF_WEIGHT_TAGS', 1),
    },
  };
}
