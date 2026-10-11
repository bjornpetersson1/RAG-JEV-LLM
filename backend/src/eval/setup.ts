// Builds the evaluation's dependencies from `.env` and the database: the configured query
// translator and candidate search (all the label tool needs), and one reranker per judge mode.

import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import { hasJevKey } from '../jev/config.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleLabel } from '../llm/config.js';
import { createQueryServices } from '../query/services.js';
import { translateQuery } from '../query/translate-query.js';
import { createReranker } from '../rerank/factory.js';
import type { Reranker } from '../rerank/types.js';
import {
  byJudgeMode,
  type EvalDependencies,
  type JudgeMode,
  type SearchDependencies,
} from './run.js';

/**
 * The reranker each judge mode forces, whatever `RERANKER` says. Without a JEV key, `tags+jev` is
 * judged by the LLM, as in the first evaluation, and the report says so.
 */
function rerankerFor(mode: JudgeMode, env: Env): 'jev' | 'llm' {
  return mode === 'tags+jev' && hasJevKey(env) ? 'jev' : 'llm';
}

export interface SearchSetup extends SearchDependencies {
  /** What the run used, for the report, e.g. `{ 'query translator': 'claude-code claude-haiku-5-5' }`. */
  settings: Record<string, string>;
}

export type EvalSetup = SearchSetup & Omit<EvalDependencies, 'onQuery'>;

/** The query translator and candidate search `.env` configures. */
export function createSearchSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  llmConfig = loadLlmConfig(env),
): SearchSetup {
  const { translation, candidateSearch, loadChunks, translatorLabel } = createQueryServices(
    db,
    env,
    logger,
    llmConfig,
  );
  return {
    settings: {
      'query translator': translatorLabel,
      'LLM judge': roleLabel(llmConfig, 'judge'),
    },
    async translate(query) {
      const { tags } = await translateQuery(query, translation);
      return tags.map((tag) => tag.slug);
    },
    search(query, tags, mode) {
      const { candidates } = candidateSearch.search({ instruction: query.instruction, tags, mode });
      return candidates.map((candidate) => String(candidate.chunkId));
    },
    loadChunks,
  };
}

/**
 * The search setup plus one reranker per judge mode, reranking with the cache on and keeping every
 * relevant candidate, so precision and recall stay comparable with the first evaluation.
 */
export function createEvalSetup(db: DatabaseSync, env: Env, logger: LlmLogger): EvalSetup {
  const llmConfig = loadLlmConfig(env);
  const byName = new Map<string, Reranker>();
  const rerankerNamed = (name: string) => {
    if (!byName.has(name)) {
      // Eval keeps every relevant chunk, so RERANK_TOP_K is not read.
      const rerankerEnv = { ...env, RERANKER: name, RERANK_TOP_K: undefined, JUDGE_CACHE: 'on' };
      byName.set(name, createReranker(rerankerEnv, { db, llmConfig, logger }).reranker);
    }
    return byName.get(name)!;
  };
  const rerankers = byJudgeMode((mode) => rerankerNamed(rerankerFor(mode, env)));
  return {
    ...createSearchSetup(db, env, logger, llmConfig),
    judge(mode, instruction, chunks) {
      return rerankers[mode].rerank(instruction, chunks, chunks.length);
    },
    judges: byJudgeMode((mode) => ({ name: rerankers[mode].name, model: rerankers[mode].model })),
  };
}
