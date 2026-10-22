// Builds the sweep's retriever and reranker from `.env` and the database (E7-4): the retriever
// `tags` (tag search with its full-text fallback, as the query flow runs it), built once per
// `MAX_CANDIDATES`, and the reranker `RERANKER` names without its cache, keeping every relevant
// chunk.

import type { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from '../db/config.js';
import type { Env } from '../env.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig } from '../llm/config.js';
import { createQueryServices } from '../query/services.js';
import { translateToSlugs } from '../query/translate-query.js';
import { DEFAULT_RERANK_TOP_K, loadRerankerConfig } from '../rerank/factory.js';
import { loadRetrievalConfig, type RetrieverName } from '../retrieval/config.js';
import { createRetriever } from '../retrieval/retriever.js';
import { createCandidateSearch } from '../search/candidate-search.js';
import { loadSearchConfig, tagIndexBuilder } from '../search/config.js';
import { loadTagIndex } from '../search/load-index.js';
import { createEvalReranker } from './setup.js';
import { SWEEP_CANDIDATES, type SweepDependencies, type SweptRetriever } from './sweep.js';

export const SWEPT_RETRIEVERS = ['tags'] as const satisfies readonly RetrieverName[];

/**
 * The default before E7-4 (`MAX_CANDIDATES` 30), which the rule's recall floor is measured from, so
 * later sweeps stay comparable with the first.
 */
export const SWEEP_BASELINES: Record<
  (typeof SWEPT_RETRIEVERS)[number],
  { candidates: number; topK: number }
> = {
  tags: { candidates: 30, topK: DEFAULT_RERANK_TOP_K },
};

export function createSweepSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
): Omit<SweepDependencies, 'onQuery' | 'onFailure'> {
  const llmConfig = loadLlmConfig(env);
  const searchConfig = loadSearchConfig(env);
  // One tag index for every count; only the candidate limit differs.
  const tagIndex = loadTagIndex(
    resolveDatabasePath(env.DATABASE_PATH),
    tagIndexBuilder(searchConfig),
    logger,
  );
  const { translation, loadChunks } = createQueryServices(
    db,
    env,
    logger,
    llmConfig,
    undefined,
    tagIndex,
  );
  const retrievalConfig = loadRetrievalConfig(env);
  const byCount = new Map(
    SWEEP_CANDIDATES.map((candidates) => [
      candidates,
      createRetriever(
        retrievalConfig,
        createCandidateSearch({
          db,
          tagIndex,
          config: { ...searchConfig, maxCandidates: candidates },
          logger,
        }),
      ),
    ]),
  );
  const retrievers = SWEPT_RETRIEVERS.map((name): SweptRetriever => ({
    name,
    usesTags: true,
    async retrieve(query, tags, candidates) {
      const retriever = byCount.get(candidates);
      if (!retriever) throw new Error(`The sweep has no retriever for ${candidates} candidates`);
      const { candidates: found } = await retriever.retrieve(query.instruction, tags);
      return found.map(({ chunkId }) => String(chunkId));
    },
  }));
  // Off, since cached scores would make every rerank time estimate near zero.
  const reranker = createEvalReranker(loadRerankerConfig(env).name, 'off', {
    env,
    db,
    llmConfig,
    logger,
  });
  return {
    retrievers,
    reranker,
    translate: (query) => translateToSlugs(query, translation),
    loadChunks,
  };
}
