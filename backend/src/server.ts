import { registerQueryRoute, type QueryFlows } from './api/query-route.js';
import { createQueryFlows, openQueryDatabase } from './api/setup.js';
import { buildApp } from './app.js';
import { resolveDatabasePath } from './db/config.js';
import { elapsedMs } from './http.js';
import { loadEmbedderConfig } from './embedding/factory.js';
import { describeError } from './errors.js';
import { loadContextLimits } from './generation/config.js';
import { createRunLog } from './generation/run-log.js';
import { createConsoleLogger } from './llm/console-logger.js';
import { loadLlmConfig } from './llm/config.js';
import { resolvePort } from './port.js';
import { loadQueryTranslatorConfig } from './query/config.js';
import { loadReferenceConfig } from './reference/config.js';
import { loadRerankerConfig } from './rerank/factory.js';
import { loadSearchConfig, tagIndexBuilder } from './search/config.js';
import { loadTagIndex } from './search/load-index.js';
import type { BuildTagIndex } from './search/tag-index.js';

const { port, databasePath, buildTagIndex } = readStartupConfig();
const app = buildApp();

try {
  app.tagIndex = loadTagIndex(databasePath, buildTagIndex, app.log);
  const flows = registerQueryFlows(databasePath);
  // Before listening, so the first query's timings do not include loading the local models.
  const warmUpStarted = performance.now();
  await flows?.warmUp?.();
  app.log.info({ ms: elapsedMs(warmUpStarted) }, 'Local models warmed up');
  await app.listen({ port });
} catch (error) {
  app.log.error(describeError(error));
  process.exit(1);
}

/**
 * Builds the query flows on the existing, migrated database, sharing the server's tag index, and
 * registers `POST /query`. Without one the server still starts, without the route, and warns. A
 * flow that cannot be built, e.g. `RETRIEVER=bge` before `npm run index:embed`, stops the server.
 */
function registerQueryFlows(databasePath: string): QueryFlows | undefined {
  const opened = openQueryDatabase(databasePath);
  if ('unavailable' in opened) {
    app.log.warn({ databasePath }, `POST /query is not available: ${opened.unavailable}`);
    return undefined;
  }
  const { db } = opened;
  app.addHook('onClose', async () => db.close());
  // Every call and search logs at info level; the server log shows only problems.
  const flows = createQueryFlows(db, process.env, createConsoleLogger({ quiet: true }), {
    tagIndex: app.tagIndex,
  });
  registerQueryRoute(
    app,
    flows,
    createRunLog((message) => app.log.warn(message)),
  );
  return flows;
}

/** Validates `.env` before listening; an invalid value prints its message and exits, no stack trace. */
function readStartupConfig(): {
  port: number;
  databasePath: string;
  buildTagIndex: BuildTagIndex;
} {
  try {
    const port = resolvePort(process.env.PORT);
    // Fail fast on every setting, also the reference RAG's (a failed build of it is only reported
    // when a query asks for it), and also when there is no database and no flow is built.
    loadLlmConfig(process.env);
    loadQueryTranslatorConfig(process.env);
    loadRerankerConfig(process.env);
    loadEmbedderConfig(process.env);
    loadReferenceConfig(process.env);
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
