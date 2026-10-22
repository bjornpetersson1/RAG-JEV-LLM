import type { Env } from '../env.js';
import { loadRerankerConfig } from '../rerank/factory.js';
import { loadSearchConfig } from '../search/config.js';

/** The reference RAG judges with the LLM whatever `RERANKER` the main flow uses: it is all LLM. */
export const REFERENCE_RERANKER = 'llm';

export interface ReferenceConfig {
  /** `MAX_CANDIDATES`: the most the main flow's tag search gives its judge (E7-9). */
  candidates: number;
  /** `RERANK_TOP_K`, as in the main flow. */
  topK: number;
}

/** `env` with the reference RAG's judge as `RERANKER`, to build and validate it from. */
export function referenceJudgeEnv(env: Env): Env {
  return { ...env, RERANKER: REFERENCE_RERANKER };
}

/**
 * Reads and validates the reference RAG's settings, its LLM judge's included, so a bad `.env` fails
 * at startup. `REFERENCE_TOP_K`, which `MAX_CANDIDATES` and `RERANK_TOP_K` replaced, is rejected.
 */
export function loadReferenceConfig(env: Env): ReferenceConfig {
  if (env.REFERENCE_TOP_K?.trim()) {
    throw new Error(
      'REFERENCE_TOP_K was removed: the reference RAG judges its MAX_CANDIDATES best chunks and ' +
        'keeps RERANK_TOP_K; remove REFERENCE_TOP_K from .env',
    );
  }
  return {
    candidates: loadSearchConfig(env).maxCandidates,
    topK: loadRerankerConfig(referenceJudgeEnv(env)).topK,
  };
}
