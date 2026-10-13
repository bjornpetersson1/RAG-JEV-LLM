// Builds the reference RAG (E5-4, E7-9) from `.env` and the database: the configured `EMBEDDER` and
// its stored vectors give the `MAX_CANDIDATES` nearest chunks, the LLM judge at `JUDGE_THRESHOLD`
// keeps at most `RERANK_TOP_K`, and the same generator and context limits as the main flow write
// the draft. `runQuery` runs it like the main flow; it has no translation step.

import type { DatabaseSync } from 'node:sqlite';
import { loadContextLimits, type ContextLimits } from '../generation/config.js';
import { modelLabel, rerankerLabel } from '../generation/flow-configuration.js';
import type { ConfiguredQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleLabel } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createChunkLoader } from '../query/services.js';
import { createReranker } from '../rerank/factory.js';
import type { Reranker } from '../rerank/types.js';
import { loadRetrievalResources, type RetrievalSource } from '../retrieval/setup.js';
import { loadReferenceConfig, REFERENCE_RERANKER, referenceJudgeEnv } from './config.js';
import { createDenseSearch } from './dense-search.js';

/** The reference RAG's steps, its judge and what they were built with: the main flow's shape. */
export type ReferenceFlow = ConfiguredQueryFlow;

/** Fails, naming `npm run index:embed`, when the chunks are not embedded with this embedder. */
export function createReferenceFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
  /** By default `EMBEDDER` and its stored vectors; the benchmark shares them with the main flow. */
  retrieval?: RetrievalSource,
  /** The main flow's reranker, used when it is the LLM judge, so both flows share one judge. */
  mainReranker?: Reranker,
): ReferenceFlow {
  const resources = loadRetrievalResources(db, env, retrieval);
  const { candidates, topK } = loadReferenceConfig(env);
  const llmConfig = loadLlmConfig(env);
  const reranker =
    mainReranker?.name === REFERENCE_RERANKER
      ? mainReranker
      : createReranker(referenceJudgeEnv(env), { db, llmConfig, logger }).reranker;
  const { embedder } = resources;
  return {
    flow: 'reference',
    search: createDenseSearch(embedder, resources.vectorIndex, candidates),
    loadChunks: createChunkLoader(db),
    rerank: (instruction, chunks) => reranker.rerank(instruction, chunks, topK),
    generator: createLlmRoles(llmConfig, { logger }).generator,
    limits: { ...loadContextLimits(env), ...limits },
    reranker,
    configuration: {
      retriever: `dense (${modelLabel(embedder)})`,
      reranker: rerankerLabel(reranker),
      generator: roleLabel(llmConfig, 'generator'),
      topK,
    },
  };
}
