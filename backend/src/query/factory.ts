import type { LlmLogger } from '../llm/client.js';
import type { QueryTranslator } from '../llm/types.js';
import { createSystemOneClient } from '../systemone/client.js';
import type { QueryTranslatorConfig } from './config.js';
import { createSystemOneQueryTranslator } from './systemone-translator.js';

export interface QueryTranslatorDependencies {
  /** The LLM roles' query translator (Anthropic or fake, per the LLM config). */
  llmTranslator: QueryTranslator;
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/** The query translator `config` selects. */
export function createQueryTranslator(
  config: QueryTranslatorConfig,
  { llmTranslator, logger, fetch }: QueryTranslatorDependencies,
): QueryTranslator {
  if (config.impl === 'llm') return llmTranslator;
  return createSystemOneQueryTranslator(
    createSystemOneClient({
      ...config.systemOne,
      provider: config.impl,
      role: 'queryTranslator',
      logger,
      fetch,
    }),
    config.threshold,
  );
}
