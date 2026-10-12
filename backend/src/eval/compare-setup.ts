// Builds the comparison's retrievers and rerankers from `.env` and the database (E8-5). The embedder
// and vectors load once, for whichever of `bge` and `both` is asked for.

import type { DatabaseSync } from 'node:sqlite';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import type { Env } from '../env.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, type LlmConfig } from '../llm/config.js';
import { warmUpLocalModels } from '../models/warm-up.js';
import { loadRetrievalConfig, type RetrieverName } from '../retrieval/config.js';
import { createRetriever } from '../retrieval/retriever.js';
import { loadRetrievalResources, type RetrievalResources } from '../retrieval/setup.js';
import type { CompareDependencies, ComparedReranker, ComparedRetriever } from './compare.js';
import { createEvalReranker, createSearchSetup } from './setup.js';

export function createCompareSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  { retrievers, rerankers }: { retrievers: readonly RetrieverName[]; rerankers: readonly string[] },
): Omit<CompareDependencies, 'onQuery'> {
  const llmConfig = loadLlmConfig(env);
  const search = createSearchSetup(db, env, logger, llmConfig);
  const config = loadRetrievalConfig(env);
  let loaded: RetrievalResources | undefined;
  const resources = () => (loaded ??= loadRetrievalResources(db, env));

  // E5-3's search modes, not the `tags` retriever: that one adds the full-text fallback, and the
  // comparison's `tags` row is E5-3's tag search without it.
  const fromSearch = (mode: 'tags' | 'fts'): ComparedRetriever => ({
    name: mode,
    usesTags: mode === 'tags',
    baseline: mode === 'fts',
    async retrieve(query, tags) {
      const started = performance.now();
      const ids = search.search(query, tags, mode);
      return { ids, elapsedMs: elapsedMs(started) };
    },
  });

  const hybrid = (name: 'bge' | 'both'): ComparedRetriever => {
    const retriever = createRetriever(
      { ...config, retriever: name },
      { db, candidateSearch: search.candidateSearch, ...resources() },
    );
    return {
      name,
      usesTags: retriever.usesTags,
      async retrieve(query, tags) {
        const { candidates, embedMs, searchMs } = await retriever.retrieve(query.instruction, tags);
        return {
          ids: candidates.map(({ chunkId }) => String(chunkId)),
          elapsedMs: (embedMs ?? 0) + searchMs,
        };
      },
    };
  };

  const compared = rerankers.map((name) => buildReranker(name, db, env, logger, llmConfig));
  return {
    retrievers: [
      ...retrievers.map((name) => (name === 'tags' ? fromSearch('tags') : hybrid(name))),
      fromSearch('fts'),
    ],
    rerankers: compared,
    warmUp: () =>
      warmUpLocalModels(
        db,
        loaded?.embedder,
        compared.flatMap((reranker) => ('cached' in reranker ? [reranker.cached] : [])),
      ),
    translate: (query) => search.translate(query),
    loadChunks: search.loadChunks,
    latencyQueries: 5,
  };
}

/** The reranker with its cache on (and, when asked for, off), or why it cannot be built. */
function buildReranker(
  name: string,
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  llmConfig: LlmConfig,
): ComparedReranker {
  const build = (cache: 'on' | 'off') =>
    createEvalReranker(name, cache, { env, db, llmConfig, logger });
  try {
    return { name, cached: build('on'), uncached: () => build('off') };
  } catch (error) {
    return { name, skipped: describeError(error) };
  }
}
