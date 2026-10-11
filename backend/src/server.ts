import { buildApp } from './app.js';
import { resolveDatabasePath } from './db/config.js';
import { loadContextLimits } from './generation/config.js';
import { loadEmbedderConfig } from './embedding/factory.js';
import { loadLlmConfig } from './llm/config.js';
import { resolvePort } from './port.js';
import { loadQueryTranslatorConfig } from './query/config.js';
import { loadRerankerConfig } from './rerank/factory.js';
import { loadTagIndex } from './search/load-index.js';
import { loadSearchConfig, tagIndexBuilder } from './search/config.js';
import type { BuildTagIndex } from './search/tag-index.js';

const { port, databasePath, buildTagIndex } = readStartupConfig();
const app = buildApp();

try {
  app.tagIndex = loadTagIndex(databasePath, buildTagIndex, app.log);
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

/** Validates `.env` before listening; an invalid value prints its message and exits, no stack trace. */
function readStartupConfig(): {
  port: number;
  databasePath: string;
  buildTagIndex: BuildTagIndex;
} {
  try {
    const port = resolvePort(process.env.PORT);
    // Fail fast on invalid LLM, query translator, reranker, embedder and generator settings; later
    // issues build the roles from them.
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
