// Builds the evaluation's dependencies from `.env` and the database: the configured query
// translator and candidate search (all the label tool needs), and one judge per judge mode.

import type { DatabaseSync } from 'node:sqlite';
import { loadJudgeConfig, loadJudgingConfig } from '../judge/config.js';
import { createJudging } from '../judge/factory.js';
import { judgeAll } from '../judge/judge-all.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleLabel } from '../llm/config.js';
import { createQueryServices } from '../query/services.js';
import { translateQuery } from '../query/translate-query.js';
import {
  byJudgeMode,
  type EvalDependencies,
  type JudgeMode,
  type SearchDependencies,
} from './run.js';

type Env = Record<string, string | undefined>;

/** The judge implementation each judge mode forces, whatever `JUDGE_IMPL` says. */
const JUDGE_IMPL_FOR: Record<JudgeMode, string> = {
  'tags+jev': 'jev-with-fallback',
  'tags+llm': 'llm',
};

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

/** The search setup plus one judge per judge mode, judging with the cache on. */
export function createEvalSetup(db: DatabaseSync, env: Env, logger: LlmLogger): EvalSetup {
  const llmConfig = loadLlmConfig(env);
  const judgingConfig = loadJudgingConfig(env);
  const judgings = byJudgeMode((mode) =>
    createJudging(loadJudgeConfig({ ...env, JUDGE_IMPL: JUDGE_IMPL_FOR[mode] }), {
      llmConfig,
      logger,
    }),
  );
  return {
    ...createSearchSetup(db, env, logger, llmConfig),
    judge(mode, instruction, chunks) {
      return judgeAll(
        instruction,
        chunks,
        { judging: judgings[mode], config: judgingConfig, db, logger },
        { cache: true },
      );
    },
    judges: byJudgeMode((mode) => judgings[mode].primary),
  };
}
