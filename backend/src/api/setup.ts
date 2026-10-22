// The flows the server's `POST /query` runs, built from `.env` and the database at startup.

import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import { migrationLabel, pendingMigrations } from '../db/migrations.js';
import type { Env } from '../env.js';
import { createQueryFlow, type ConfiguredQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { createReferenceFlow, type ReferenceFlow } from '../reference/setup.js';
import type { TagIndex } from '../search/tag-index.js';
import type { QueryFlows } from './query-route.js';

export interface QueryFlowsOptions {
  /** The server's tag index; by default built from the database. */
  tagIndex?: TagIndex;
}

/** The flows with their rerankers, so both can be seen to share one judge. */
export interface ConfiguredQueryFlows extends QueryFlows {
  main(): ConfiguredQueryFlow;
  reference(): ReferenceFlow;
}

/** Both flows; the reference RAG shares the main flow's reranker when that is the LLM judge. */
export function createQueryFlows(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  { tagIndex }: QueryFlowsOptions = {},
): ConfiguredQueryFlows {
  const main = createQueryFlow(db, env, logger, {}, tagIndex);
  const reference = createReferenceFlow(db, env, logger, {}, main.reranker);
  return { main: () => main, reference: () => reference };
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
