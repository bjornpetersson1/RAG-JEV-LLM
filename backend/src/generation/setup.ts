// Builds the query flow's steps from `.env` and the database: the configured query translator,
// retriever (`RETRIEVER`, E8-4), reranker (`RERANKER`, E8-1) and generator.

import type { DatabaseSync } from 'node:sqlite';
import type { Embedder } from '../embedding/types.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createQueryServices } from '../query/services.js';
import { translateQuery } from '../query/translate-query.js';
import { createReranker } from '../rerank/factory.js';
import { createConfiguredRetriever } from '../retrieval/setup.js';
import { loadContextLimits, type ContextLimits } from './config.js';
import type { QueryFlowDependencies } from './query-flow.js';

export function createQueryFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
  /** A fake embedder in tests; by default `EMBEDDER`. */
  embedder?: Embedder,
): QueryFlowDependencies {
  const llmConfig = loadLlmConfig(env);
  const { reranker, topK } = createReranker(env, { db, llmConfig, logger });
  const roles = createLlmRoles(llmConfig, { logger });
  const { translation, candidateSearch, loadChunks } = createQueryServices(
    db,
    env,
    logger,
    llmConfig,
    roles,
  );
  const retriever = createConfiguredRetriever(db, env, candidateSearch, embedder);
  return {
    ...(retriever.usesTags && { translate: (query) => translateQuery(query, translation) }),
    search: (instruction, tags) => retriever.retrieve(instruction, tags),
    loadChunks,
    rerank: (instruction, chunks) => reranker.rerank(instruction, chunks, topK),
    generator: roles.generator,
    limits: { ...loadContextLimits(env), ...limits },
  };
}
