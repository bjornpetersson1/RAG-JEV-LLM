import { buildApp } from './app.js';
import { loadLlmConfig } from './llm/config.js';
import { resolvePort } from './port.js';

const port = readStartupConfig();
const app = buildApp();

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

/** Validates `.env` before listening; an invalid value prints its message and exits, no stack trace. */
function readStartupConfig(): number {
  try {
    const port = resolvePort(process.env.PORT);
    // Fail fast on invalid LLM settings; later issues build the roles from this config for their routes.
    loadLlmConfig(process.env);
    return port;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
