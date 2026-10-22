import { readOneOf, readPositiveInteger, type Env } from '../env.js';
import { jevReranker, llmReranker, subqReranker } from './judge-reranker.js';
import type { Reranker, RerankerDependencies, RerankerEntry } from './types.js';

/** Every `RERANKER` value and its implementation; no other code branches on the reranker. */
export const RERANKERS: Readonly<Record<string, RerankerEntry>> = {
  jev: jevReranker,
  llm: llmReranker,
  subq: subqReranker,
};

// A judge that says yes or no per chunk against JUDGE_THRESHOLD, as the requirements' query flow
// has it (E7-7). The System One judges `subq` and `jev` (paused) are chosen in .env.
const DEFAULT_RERANKER = 'llm';
export const DEFAULT_RERANK_TOP_K = 8;

export interface RerankerConfig {
  /** The `RERANKER` value. */
  name: string;
  /** `RERANK_TOP_K`: the most chunks a rerank keeps. */
  topK: number;
}

/**
 * Reads `RERANKER` and `RERANK_TOP_K` and validates the chosen reranker's own settings, so a bad
 * `.env` fails at startup.
 */
export function loadRerankerConfig(env: Env, registry = RERANKERS): RerankerConfig {
  const config = selectReranker(env, registry);
  registry[config.name].validate(env);
  return config;
}

/** Whether the reranker calls a remote model (an LLM, JEV or SubQ), as its registry entry says. */
export function isRemoteReranker(reranker: Pick<Reranker, 'name'>, registry = RERANKERS): boolean {
  return registry[reranker.name]?.remote ?? false;
}

/** The reranker `RERANKER` selects, with `RERANK_TOP_K`; it reads its own settings once. */
export function createReranker(
  env: Env,
  deps: RerankerDependencies,
  registry = RERANKERS,
): { reranker: Reranker; topK: number } {
  const { name, topK } = selectReranker(env, registry);
  return { reranker: registry[name].create(env, deps), topK };
}

/** `RERANKER` and `RERANK_TOP_K`; `JUDGE_IMPL`, which `RERANKER` replaced, is rejected. */
function selectReranker(
  env: Env,
  registry: Readonly<Record<string, RerankerEntry>>,
): RerankerConfig {
  const names = Object.keys(registry);
  if (env.JUDGE_IMPL?.trim()) {
    throw new Error(
      `JUDGE_IMPL was replaced by RERANKER (${names.join(', ')}); remove JUDGE_IMPL from .env`,
    );
  }
  const name = readOneOf(env, 'RERANKER', names, DEFAULT_RERANKER);
  return { name, topK: readPositiveInteger(env, 'RERANK_TOP_K', DEFAULT_RERANK_TOP_K) };
}
