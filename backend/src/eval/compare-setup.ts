// Builds the comparison's retrievers and rerankers from `.env` and the database (E8-5).

import type { DatabaseSync } from 'node:sqlite';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import type { Env } from '../env.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, type LlmConfig } from '../llm/config.js';
import type { CompareDependencies, ComparedReranker, ComparedRetriever } from './compare.js';
import { createEvalReranker, createSearchSetup } from './setup.js';

/** Queries a reranker's latency is taken over when its cache answered. */
export const LATENCY_QUERIES = 5;

export function createCompareSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  rerankers: readonly string[],
): Omit<CompareDependencies, 'onQuery'> {
  const llmConfig = loadLlmConfig(env);
  const search = createSearchSetup(db, env, logger, llmConfig);

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

  return {
    retrievers: [fromSearch('tags'), fromSearch('fts')],
    rerankers: rerankers.map((name) => buildReranker(name, db, env, logger, llmConfig)),
    translate: (query) => search.translate(query),
    translator: search.settings['query translator'],
    loadChunks: search.loadChunks,
    latencyQueries: LATENCY_QUERIES,
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
