import { readOneOf, readPositiveInteger, type Env } from '../env.js';
import { bgeReranker } from './bge-reranker.js';
import { jevReranker, llmReranker } from './judge-reranker.js';
import { minilmReranker } from './minilm-reranker.js';
import { qwen3Reranker } from './qwen3-reranker.js';
import type { CrossEncoderSpec, Reranker, RerankerDependencies, RerankerEntry } from './types.js';

/** Every `RERANKER` value and its implementation; no other code branches on the reranker. */
export const RERANKERS: Readonly<Record<string, RerankerEntry>> = {
  // A cross-encoder is filed under its own name, which also names its threshold setting.
  ...Object.fromEntries(
    [bgeReranker, minilmReranker].map((entry) => [entry.crossEncoder.name, entry]),
  ),
  jev: jevReranker,
  llm: llmReranker,
  qwen3: qwen3Reranker,
};

/** The local cross-encoders in the registry, e.g. for `bench:rerank`. */
export function localCrossEncoders(registry = RERANKERS): CrossEncoderSpec[] {
  return Object.values(registry).flatMap((entry) => entry.crossEncoder ?? []);
}

// Local, free and fast (E7-5: within 0.03 of BGE's recall@8 at a ninth of its time); `bge`, `jev`
// or `llm` are chosen in .env.
export const DEFAULT_RERANKER = 'minilm';
const DEFAULT_RERANK_TOP_K = 8;

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

/** Whether the reranker calls a remote model (an LLM or JEV), as its registry entry says. */
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
