import { createAnthropicClient } from './anthropic-client.js';
import type { LlmClient, LlmLogger } from './client.js';
import type { LlmConfig } from './config.js';
import {
  createFakeGenerator,
  createFakeJudge,
  createFakeQueryTranslator,
  createFakeTagger,
} from './fakes.js';
import {
  createLlmGenerator,
  createLlmJudge,
  createLlmQueryTranslator,
  createLlmTagger,
} from './roles.js';
import type { LlmRoles, RoleName } from './types.js';

export interface LlmDependencies {
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/** Builds every role with the provider and model the config gives it. */
export function createLlmRoles(config: LlmConfig, deps: LlmDependencies): LlmRoles {
  const build = <T>(role: RoleName, real: (client: LlmClient) => T, fake: () => T): T => {
    const roleConfig = config.roles[role];
    if (roleConfig.provider === 'fake') return fake();
    return real(
      createAnthropicClient({
        role,
        model: roleConfig.model,
        apiKey: roleConfig.apiKey,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        logger: deps.logger,
        fetch: deps.fetch,
      }),
    );
  };

  return {
    tagger: build('tagger', createLlmTagger, createFakeTagger),
    queryTranslator: build('queryTranslator', createLlmQueryTranslator, createFakeQueryTranslator),
    judge: build('judge', createLlmJudge, createFakeJudge),
    generator: build('generator', createLlmGenerator, createFakeGenerator),
  };
}
