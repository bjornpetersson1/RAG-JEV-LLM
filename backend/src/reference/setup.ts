// Builds the reference RAG (E5-4) from `.env` and the database: the configured `EMBEDDER` and its
// stored vectors, `REFERENCE_TOP_K` and the same generator and context limits as the main flow.
// `runQuery` runs it like the main flow; it has no translation or rerank step.

import type { DatabaseSync } from 'node:sqlite';
import type { Embedder } from '../embedding/types.js';
import { loadContextLimits, type ContextLimits } from '../generation/config.js';
import type { QueryFlowDependencies } from '../generation/query-flow.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createChunkLoader } from '../query/services.js';
import { loadRetrievalResources, type RetrievalSource } from '../retrieval/setup.js';
import { loadReferenceTopK } from './config.js';
import { createDenseSearch } from './dense-search.js';

/** The reference RAG's steps, and what they were built with, for reports. */
export interface ReferenceFlow extends QueryFlowDependencies {
  embedder: Embedder;
  topK: number;
}

/** Fails, naming `npm run index:embed`, when the chunks are not embedded with this embedder. */
export function createReferenceFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
  /** By default `EMBEDDER` and its stored vectors; the benchmark shares them with the main flow. */
  retrieval?: RetrievalSource,
): ReferenceFlow {
  const resources = loadRetrievalResources(db, env, retrieval);
  const topK = loadReferenceTopK(env);
  return {
    flow: 'reference',
    search: createDenseSearch(resources.embedder, resources.vectorIndex, topK),
    loadChunks: createChunkLoader(db),
    generator: createLlmRoles(loadLlmConfig(env), { logger }).generator,
    limits: { ...loadContextLimits(env), ...limits },
    embedder: resources.embedder,
    topK,
  };
}
