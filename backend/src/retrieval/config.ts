import { readOneOf, type Env } from '../env.js';

/** Where candidates come from: tag search with its full-text fallback (E4). */
export const RETRIEVERS = ['tags'] as const;
export type RetrieverName = (typeof RETRIEVERS)[number];

export interface RetrievalConfig {
  retriever: RetrieverName;
}

/** Reads `RETRIEVER` (`tags`, the only one left since E10-1). */
export function loadRetrievalConfig(env: Env): RetrievalConfig {
  return { retriever: readOneOf(env, 'RETRIEVER', RETRIEVERS, 'tags') };
}
