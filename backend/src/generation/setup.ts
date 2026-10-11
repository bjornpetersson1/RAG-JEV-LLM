// Builds the query flow's steps from `.env` and the database: the configured query translator,
// candidate search (`tags+fts`), judge (E5-2's `judgeAll`) and generator.

import type { DatabaseSync } from 'node:sqlite';
import { loadJudgeConfig, loadJudgingConfig } from '../judge/config.js';
import { createJudging } from '../judge/factory.js';
import { judgeAll } from '../judge/judge-all.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createQueryServices } from '../query/services.js';
import { translateQuery } from '../query/translate-query.js';
import { loadContextLimits, type ContextLimits } from './config.js';
import type { QueryFlowDependencies } from './query-flow.js';

export function createQueryFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
): QueryFlowDependencies {
  const llmConfig = loadLlmConfig(env);
  const judgingConfig = loadJudgingConfig(env);
  // createJudging builds its own LLM judge from llmConfig, so the judge and its cache key agree.
  const judging = createJudging(loadJudgeConfig(env), { llmConfig, logger });
  const roles = createLlmRoles(llmConfig, { logger });
  const { translation, candidateSearch, loadChunks } = createQueryServices(
    db,
    env,
    logger,
    llmConfig,
    roles,
  );
  return {
    translate: (query) => translateQuery(query, translation),
    search: (instruction, tags) => candidateSearch.search({ instruction, tags, mode: 'tags+fts' }),
    loadChunks,
    judge: (instruction, chunks) =>
      judgeAll(instruction, chunks, { judging, config: judgingConfig, db, logger }),
    generator: roles.generator,
    limits: { ...loadContextLimits(env), ...limits },
  };
}
