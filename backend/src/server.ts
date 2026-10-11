import { buildApp } from './app.js';
import { resolveDatabasePath } from './db/config.js';
import { loadLlmConfig } from './llm/config.js';
import { resolvePort } from './port.js';
import { loadTagIndex } from './search/load-index.js';
import { buildRoaringIndex } from './search/roaring-index.js';

const { port, databasePath } = readStartupConfig();
const app = buildApp();

try {
  app.tagIndex = loadTagIndex(databasePath, buildRoaringIndex, app.log);
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

/** Validates `.env` before listening; an invalid value prints its message and exits, no stack trace. */
function readStartupConfig(): { port: number; databasePath: string } {
  try {
    const port = resolvePort(process.env.PORT);
    // Fail fast on invalid LLM settings; later issues build the roles from this config for their routes.
    loadLlmConfig(process.env);
    return { port, databasePath: resolveDatabasePath(process.env.DATABASE_PATH) };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
