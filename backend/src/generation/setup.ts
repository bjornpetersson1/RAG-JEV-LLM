// Builds the query flow's steps from `.env` and the database: the configured query translator,
// retriever (`RETRIEVER`, E8-4), reranker (`RERANKER`, E8-1) and generator.

import type { DatabaseSync } from 'node:sqlite';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleLabel } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createQueryServices } from '../query/services.js';
import { translateQuery } from '../query/translate-query.js';
import { createReranker } from '../rerank/factory.js';
import type { Reranker } from '../rerank/types.js';
import type { RetrieverName } from '../retrieval/config.js';
import { createConfiguredRetriever, type RetrievalSource } from '../retrieval/setup.js';
import { loadContextLimits, type ContextLimits } from './config.js';
import type { QueryFlowDependencies } from './query-flow.js';

/** The query flow's steps, and what they were built with, for reports. */
export interface ConfiguredQueryFlow extends QueryFlowDependencies {
  rerank: NonNullable<QueryFlowDependencies['rerank']>;
  retriever: RetrieverName;
  reranker: Reranker;
  topK: number;
  /** E.g. `claude-code claude-sonnet-5-5`. */
  generatorLabel: string;
}

export function createQueryFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
  /** For `RETRIEVER=bge|both`; by default `EMBEDDER` and its stored vectors. */
  retrieval?: RetrievalSource,
): ConfiguredQueryFlow {
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
  const retriever = createConfiguredRetriever(db, env, candidateSearch, retrieval);
  return {
    ...(retriever.usesTags && { translate: (query) => translateQuery(query, translation) }),
    search: (instruction, tags) => retriever.retrieve(instruction, tags),
    loadChunks,
    rerank: (instruction, chunks) => reranker.rerank(instruction, chunks, topK),
    generator: roles.generator,
    limits: { ...loadContextLimits(env), ...limits },
    retriever: retriever.name,
    reranker,
    topK,
    generatorLabel: roleLabel(llmConfig, 'generator'),
  };
}
