// The flows the server's `POST /query` runs, built from `.env` and the database at startup. The
// reference RAG is built when the models warm up, or on its first use if that failed, so a server
// without embeddings still answers the main flow and reports the missing `npm run index:embed`
// only when the reference RAG is asked for.

import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import { migrationLabel, pendingMigrations } from '../db/migrations.js';
import type { Env } from '../env.js';
import type { QueryFlowDependencies } from '../generation/query-flow.js';
import { createQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { warmUpLocalModels } from '../models/warm-up.js';
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
  const buildReference = () =>
    (reference ??= createReferenceFlow(db, env, logger, {}, loadResources()));
  return {
    main: () => main,
    reference: buildReference,
    async warmUp() {
      // The reference RAG loads the embedder and vectors; without them only the reranker warms up.
      try {
        buildReference();
      } catch {
        // Reported when a query asks for the reference RAG.
      }
      await warmUpLocalModels(db, resources?.embedder, [main.reranker]);
    },
  };
}

/**
 * The database the query flows run on, or why there is none: it is missing, or migrations are
 * pending. It is never created or migrated here; the server then starts without `POST /query`.
 */
export function openQueryDatabase(path: string): { db: DatabaseSync } | { unavailable: string } {
  if (!existsSync(path)) {
    return { unavailable: 'there is no database; run `npm run db:migrate` and the data commands' };
  }
  const db = openDatabase(path);
  const pending = pendingMigrations(db);
  if (pending.length === 0) return { db };
  db.close();
  return {
    unavailable: `migrations are pending (${pending.map(migrationLabel).join(', ')}); run \`npm run db:migrate\``,
  };
}
