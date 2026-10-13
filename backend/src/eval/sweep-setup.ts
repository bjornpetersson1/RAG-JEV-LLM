// Builds the sweep's retrievers and reranker from `.env` and the database (E7-4): the retrievers
// `tags` (tag search with its full-text fallback, as the query flow runs it), built once per
// `MAX_CANDIDATES`, and `both`, built once per `RETRIEVE_CANDIDATES` over the configured tag search
// (its tag ranking is capped by `MAX_CANDIDATES` in the query flow too), and the configured
// `RERANKER` without its cache, keeping every relevant chunk.

import type { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from '../db/config.js';
import type { Embedder, Embedding } from '../embedding/types.js';
import type { Env } from '../env.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig } from '../llm/config.js';
import { warmUpLocalModels } from '../models/warm-up.js';
import { createQueryServices } from '../query/services.js';
import { translateToSlugs } from '../query/translate-query.js';
import { DEFAULT_RERANK_TOP_K, loadRerankerConfig } from '../rerank/factory.js';
import { loadRetrievalConfig, type RetrieverName } from '../retrieval/config.js';
import { createRetriever } from '../retrieval/retriever.js';
import { loadRetrievalResources } from '../retrieval/setup.js';
import { createCandidateSearch } from '../search/candidate-search.js';
import { loadSearchConfig, tagIndexBuilder } from '../search/config.js';
import { loadTagIndex } from '../search/load-index.js';
import { createEvalReranker } from './setup.js';
import { SWEEP_CANDIDATES, type SweepDependencies, type SweptRetriever } from './sweep.js';

export const SWEPT_RETRIEVERS = ['tags', 'both'] as const satisfies readonly RetrieverName[];

/**
 * The defaults before E7-4 (`MAX_CANDIDATES` 30, `RETRIEVE_CANDIDATES` 40), which the rule's recall
 * floor is measured from, so later sweeps stay comparable with the first.
 */
export const SWEEP_BASELINES: Record<
  (typeof SWEPT_RETRIEVERS)[number],
  { candidates: number; topK: number }
> = {
  tags: { candidates: 30, topK: DEFAULT_RERANK_TOP_K },
  both: { candidates: 40, topK: DEFAULT_RERANK_TOP_K },
};

export function createSweepSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
): Omit<SweepDependencies, 'onQuery' | 'onFailure'> & { warmUp(): Promise<void> } {
  const llmConfig = loadLlmConfig(env);
  const searchConfig = loadSearchConfig(env);
  // One tag index for every count; only the candidate limit differs.
  const tagIndex = loadTagIndex(
    resolveDatabasePath(env.DATABASE_PATH),
    tagIndexBuilder(searchConfig),
    logger,
  );
  const { translation, candidateSearch, loadChunks } = createQueryServices(
    db,
    env,
    logger,
    llmConfig,
    undefined,
    tagIndex,
  );
  const loaded = loadRetrievalResources(db, env);
  // `both` asks for the same query's embedding once per count.
  const resources = { ...loaded, embedder: rememberingLastQuery(loaded.embedder) };
  const retrievalConfig = loadRetrievalConfig(env);
  const retrieversFor = (name: RetrieverName) =>
    new Map(
      SWEEP_CANDIDATES.map((candidates) => {
        const search =
          name === 'tags'
            ? createCandidateSearch({
                db,
                tagIndex,
                config: { ...searchConfig, maxCandidates: candidates },
                logger,
              })
            : candidateSearch;
        const retriever = createRetriever(
          { ...retrievalConfig, retriever: name, candidates },
          { db, candidateSearch: search, ...resources },
        );
        return [candidates, retriever];
      }),
    );
  const retrievers = SWEPT_RETRIEVERS.map((name): SweptRetriever => {
    const byCount = retrieversFor(name);
    return {
      name,
      usesTags: byCount.get(SWEEP_CANDIDATES[0])?.usesTags ?? false,
      async retrieve(query, tags, candidates) {
        const retriever = byCount.get(candidates);
        if (!retriever) throw new Error(`The sweep has no retriever for ${candidates} candidates`);
        const { candidates: found } = await retriever.retrieve(query.instruction, tags);
        return found.map(({ chunkId }) => String(chunkId));
      },
    };
  });
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
    warmUp: () => warmUpLocalModels(db, resources.embedder, [reranker]),
  };
}

/** The embedder, answering a repeat of the last single query from memory. */
function rememberingLastQuery(embedder: Embedder): Embedder {
  let last: { text: string; embedding: Embedding[] } | undefined;
  return {
    name: embedder.name,
    model: embedder.model,
    dtype: embedder.dtype,
    async embed(texts, kind) {
      if (kind !== 'query' || texts.length !== 1) return embedder.embed(texts, kind);
      if (last?.text !== texts[0])
        last = { text: texts[0], embedding: await embedder.embed(texts, kind) };
      return last.embedding;
    },
  };
}
