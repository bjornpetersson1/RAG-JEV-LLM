import { buildApp } from './app.js';
import { LlmConfigError, loadLlmConfig } from './llm/config.js';
import { resolvePort } from './port.js';

const port = resolvePort(process.env.PORT);
// Fail fast on invalid LLM settings; later issues build the roles from this config for their routes.
exitOnInvalidLlmConfig();
const app = buildApp();

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function exitOnInvalidLlmConfig(): void {
  try {
    loadLlmConfig(process.env);
  } catch (error) {
    if (!(error instanceof LlmConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
