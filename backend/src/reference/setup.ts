// Builds the reference RAG (E5-4, E7-9, E10-1) from `.env` and the database: FTS5 BM25 gives the
// `MAX_CANDIDATES` best chunks, the LLM judge at `JUDGE_THRESHOLD` keeps at most `RERANK_TOP_K`,
// and the same generator and context limits as the main flow write the draft. `runQuery` runs it like the main flow; it has no translation step.

import type { DatabaseSync } from 'node:sqlite';
import { loadContextLimits, type ContextLimits } from '../generation/config.js';
import { rerankerLabel } from '../generation/flow-configuration.js';
import type { ConfiguredQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleLabel } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createChunkLoader } from '../query/services.js';
import { createReranker } from '../rerank/factory.js';
import type { Reranker } from '../rerank/types.js';
import { loadReferenceConfig, REFERENCE_RERANKER, referenceJudgeEnv } from './config.js';
import { createLexicalSearch } from './lexical-search.js';

/** The reference RAG's steps, its judge and what they were built with: the main flow's shape. */
export type ReferenceFlow = ConfiguredQueryFlow;

/** The reference RAG's retriever, as its configuration names it. */
export const REFERENCE_RETRIEVER = 'bm25';

export function createReferenceFlow(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  limits: Partial<ContextLimits> = {},
  /** The main flow's reranker, used when it is the LLM judge, so both flows share one judge. */
  mainReranker?: Reranker,
): ReferenceFlow {
  const { candidates, topK } = loadReferenceConfig(env);
  const llmConfig = loadLlmConfig(env);
  const reranker =
    mainReranker?.name === REFERENCE_RERANKER
      ? mainReranker
      : createReranker(referenceJudgeEnv(env), { db, llmConfig, logger }).reranker;
  return {
    flow: 'reference',
    search: createLexicalSearch(db, candidates),
    loadChunks: createChunkLoader(db),
    rerank: (instruction, chunks) => reranker.rerank(instruction, chunks, topK),
    generator: createLlmRoles(llmConfig, { logger }).generator,
    limits: { ...loadContextLimits(env), ...limits },
    reranker,
    configuration: {
      retriever: REFERENCE_RETRIEVER,
      reranker: rerankerLabel(reranker),
      generator: roleLabel(llmConfig, 'generator'),
      topK,
    },
  };
}
