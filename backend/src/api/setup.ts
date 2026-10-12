// The flows the server's `POST /query` runs, built from `.env` and the database at startup. The
// reference RAG is built on its first use, so a server without embeddings still answers the main
// flow and reports the missing `npm run index:embed` only when the reference RAG is asked for.

import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import type { QueryFlowDependencies } from '../generation/query-flow.js';
import { createQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { createReferenceFlow } from '../reference/setup.js';
import { loadRetrievalConfig } from '../retrieval/config.js';
import {
  loadRetrievalResources,
  type RetrievalResources,
  type RetrievalSource,
} from '../retrieval/setup.js';
import type { TagIndex } from '../search/tag-index.js';
import type { QueryFlows } from './query-route.js';

export interface QueryFlowsOptions {
  /** A fake embedder in tests; by default `EMBEDDER`. */
  retrieval?: RetrievalSource;
  /** The server's tag index; by default built from the database. */
  tagIndex?: TagIndex;
}

/**
 * The embedder and vectors load once, shared by both flows, when the first flow needs them. Fails
 * when the main flow cannot be built, e.g. `RETRIEVER=bge` before `npm run index:embed`.
 */
export function createQueryFlows(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  { retrieval, tagIndex }: QueryFlowsOptions = {},
): QueryFlows {
  let resources: RetrievalResources | undefined;
  const loadResources = () => (resources ??= loadRetrievalResources(db, env, retrieval));
  const usesEmbeddings = loadRetrievalConfig(env).retriever !== 'tags';
  const main = createQueryFlow(
    db,
    env,
    logger,
    {},
    usesEmbeddings ? loadResources() : undefined,
    tagIndex,
  );
  let reference: QueryFlowDependencies | undefined;
  return {
    main: () => main,
    reference: () => (reference ??= createReferenceFlow(db, env, logger, {}, loadResources())),
  };
}
