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
import type { TagIndex } from '../search/tag-index.js';
import { createConfiguredRetriever, type RetrievalSource } from '../retrieval/setup.js';
import { loadContextLimits, type ContextLimits } from './config.js';
import { modelLabel, rerankerLabel, type FlowConfiguration } from './flow-configuration.js';
import type { QueryFlowDependencies } from './query-flow.js';

/** The query flow's steps, the reranker itself (for a warm-up) and what they were built with. */
export interface ConfiguredQueryFlow extends QueryFlowDependencies {
  rerank: NonNullable<QueryFlowDependencies['rerank']>;
  reranker: Reranker;
  configuration: FlowConfiguration;
}

export function createQueryFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
  /** For `RETRIEVER=bge|both`; by default `EMBEDDER` and its stored vectors. */
  retrieval?: RetrievalSource,
  /** The server's tag index; by default built from the database. */
  tagIndex?: TagIndex,
): ConfiguredQueryFlow {
  const llmConfig = loadLlmConfig(env);
  const { reranker, topK } = createReranker(env, { db, llmConfig, logger });
  const roles = createLlmRoles(llmConfig, { logger });
  const { translation, candidateSearch, loadChunks, translatorLabel, tagIndexLabel } =
    createQueryServices(db, env, logger, llmConfig, roles, tagIndex);
  const retriever = createConfiguredRetriever(db, env, candidateSearch, retrieval);
  return {
    ...(retriever.usesTags && { translate: (query) => translateQuery(query, translation) }),
    search: (instruction, tags) => retriever.retrieve(instruction, tags),
    loadChunks,
    rerank: (instruction, chunks) => reranker.rerank(instruction, chunks, topK),
    generator: roles.generator,
    limits: { ...loadContextLimits(env), ...limits },
    reranker,
    configuration: {
      retriever: retriever.embedder
        ? `${retriever.name} (${modelLabel(retriever.embedder)})`
        : retriever.name,
      reranker: rerankerLabel(reranker),
      ...(retriever.usesTags && {
        translator: translatorLabel,
        tagIndex: tagIndexLabel,
      }),
      generator: roleLabel(llmConfig, 'generator'),
      topK,
    },
  };
}
