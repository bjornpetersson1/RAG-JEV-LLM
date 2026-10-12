import { existsSync } from 'node:fs';
import { registerQueryRoute } from './api/query-route.js';
import { createQueryFlows } from './api/setup.js';
import { buildApp } from './app.js';
import { resolveDatabasePath } from './db/config.js';
import { openDatabase } from './db/database.js';
import { loadEmbedderConfig } from './embedding/factory.js';
import { describeError } from './errors.js';
import { loadContextLimits } from './generation/config.js';
import { createConsoleLogger } from './llm/console-logger.js';
import { loadLlmConfig } from './llm/config.js';
import { resolvePort } from './port.js';
import { loadQueryTranslatorConfig } from './query/config.js';
import { loadRerankerConfig } from './rerank/factory.js';
import { loadSearchConfig, tagIndexBuilder } from './search/config.js';
import { loadTagIndex } from './search/load-index.js';
import type { BuildTagIndex } from './search/tag-index.js';

const { port, databasePath, buildTagIndex } = readStartupConfig();
const app = buildApp();

try {
  app.tagIndex = loadTagIndex(databasePath, buildTagIndex, app.log);
  registerQueryFlows(databasePath);
  await app.listen({ port });
} catch (error) {
  app.log.error(describeError(error));
  process.exit(1);
}

/**
 * Builds the query flows on the existing database, sharing the server's tag index, and registers
 * `POST /query`. Without a database the server still starts, without the route; it never creates
 * or migrates the database. A flow that cannot be built, e.g. `RETRIEVER=bge` before
 * `npm run index:embed`, stops the server.
 */
function registerQueryFlows(databasePath: string): void {
  if (!existsSync(databasePath)) {
    app.log.warn(
      { databasePath },
      'No database, so POST /query is not available; run `npm run db:migrate` and the data commands',
    );
    return;
  }
  const db = openDatabase(databasePath);
  app.addHook('onClose', async () => db.close());
  // Every call and search logs at info level; the server log shows only problems.
  const flows = createQueryFlows(db, process.env, createConsoleLogger({ quiet: true }), {
    tagIndex: app.tagIndex,
  });
  registerQueryRoute(app, flows);
}

/** Validates `.env` before listening; an invalid value prints its message and exits, no stack trace. */
function readStartupConfig(): {
  port: number;
  databasePath: string;
  buildTagIndex: BuildTagIndex;
} {
  try {
    const port = resolvePort(process.env.PORT);
    // Fail fast on every setting, also those of the reference RAG, which is built on first use,
    // and also when there is no database and no flow is built.
    loadLlmConfig(process.env);
    loadQueryTranslatorConfig(process.env);
    loadRerankerConfig(process.env);
    loadEmbedderConfig(process.env);
    loadContextLimits(process.env);
    return {
      port,
      databasePath: resolveDatabasePath(process.env.DATABASE_PATH),
      buildTagIndex: tagIndexBuilder(loadSearchConfig(process.env)),
    };
  } catch (error) {
    console.error(describeError(error));
    process.exit(1);
  }
}
