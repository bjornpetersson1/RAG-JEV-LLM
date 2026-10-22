// `npm run retrieve -- "<question>" [--top-k <n>]` (E8-4).

import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { rejectRemovedSettings } from '../removed-settings.js';
import { createConsoleLogger } from '../llm/console-logger.js';
import { loadLlmConfig } from '../llm/config.js';
import { createQueryServices } from '../query/services.js';
import { translateToSlugs } from '../query/translate-query.js';
import { createReranker } from '../rerank/factory.js';
import { formatRetrieveResult, parseRetrieveArgs, retrieve, RETRIEVE_USAGE } from './retrieve.js';
import { loadRetrievalConfig } from './config.js';
import { createRetriever } from './retriever.js';

// Every call and search logs at info level; the printed result already says what happened.
const logger = createConsoleLogger({ quiet: true });

const [command, ...args] = process.argv.slice(2);
try {
  rejectRemovedSettings(process.env);
  if (command === 'retrieve') process.exitCode = await retrieveCommand(args);
  else {
    console.error('Usage: cli.ts retrieve "<question>" [--top-k <n>]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function retrieveCommand(args: string[]): Promise<number> {
  const parsed = parseRetrieveArgs(args);
  if (!parsed) {
    console.error(RETRIEVE_USAGE);
    return 1;
  }
  const env = process.env;
  return withDatabase(async (db) => {
    const llmConfig = loadLlmConfig(env);
    const { translation, candidateSearch, loadChunks } = createQueryServices(
      db,
      env,
      logger,
      llmConfig,
    );
    const { reranker, topK } = createReranker(env, { db, llmConfig, logger });
    const result = await retrieve(parsed.question, parsed.topK ?? topK, {
      retriever: createRetriever(loadRetrievalConfig(env), candidateSearch),
      translate: (question) => translateToSlugs({ instruction: question }, translation),
      loadChunks,
      reranker,
    });
    console.log(formatRetrieveResult(result));
    return 0;
  });
}
