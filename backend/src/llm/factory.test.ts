import { describe, expect, it } from 'vitest';
import { loadLlmConfig } from './config.js';
import { createLlmRoles } from './factory.js';
import { createCapturingLogger, createFakeFetch, messageResponse } from './test-helpers.js';
import type { LlmRoles } from './types.js';

const VOCABULARY = ['employment', 'salary', 'notice'].map((slug) => ({
  slug,
  label: slug,
  description: slug,
  area: 'anstallning',
}));
const CHUNK = { id: 'c1', text: 'employment terms' };

/** Answers each request with data that fits the schema the role asked for. */
function answerForSchema(body: Record<string, unknown>): Response {
  const format = (body.output_config as { format: { schema: { properties: object } } }).format;
  const fields = Object.keys(format.schema.properties);
  if (fields.includes('tags')) return messageResponse({ tags: ['employment', 'salary', 'notice'] });
  if (fields.includes('relevant')) return messageResponse({ relevant: true, score: 0.9 });
  return messageResponse({ text: 'Draft', references: ['c1'] });
}

async function callEveryRole(roles: LlmRoles) {
  await roles.tagger.tag({ text: 'text' }, VOCABULARY);
  await roles.queryTranslator.translate('instruction', VOCABULARY);
  await roles.judge.judge('instruction', CHUNK);
  await roles.generator.generate({ template: 'T', instruction: 'I', chunks: [CHUNK] });
}

/** Builds the roles from `env` alone and returns the model each Anthropic call used, by role. */
async function modelsUsed(env: Record<string, string>) {
  const { fetch, requests } = createFakeFetch(answerForSchema);
  const logger = createCapturingLogger();

  await callEveryRole(createLlmRoles(loadLlmConfig(env), { logger, fetch }));

  return {
    requestModels: requests.map((request) => request.body.model),
    loggedRoles: logger.info.mock.calls.map(([entry]) => [entry.role, entry.model]),
  };
}

describe('createLlmRoles', () => {
  const base = { LLM_PROVIDER: 'anthropic', LLM_MODEL: 'model-a', ANTHROPIC_API_KEY: 'key' };

  it('uses the default provider and model for every role', async () => {
    const { loggedRoles, requestModels } = await modelsUsed(base);

    expect(requestModels).toEqual(['model-a', 'model-a', 'model-a', 'model-a']);
    expect(loggedRoles).toEqual([
      ['tagger', 'model-a'],
      ['queryTranslator', 'model-a'],
      ['judge', 'model-a'],
      ['generator', 'model-a'],
    ]);
  });

  it('switches model and provider per role through env values only', async () => {
    const { loggedRoles, requestModels } = await modelsUsed({
      ...base,
      LLM_GENERATOR_MODEL: 'model-b',
      LLM_JUDGE_PROVIDER: 'fake',
    });

    expect(requestModels).toEqual(['model-a', 'model-a', 'model-b']);
    expect(loggedRoles).toEqual([
      ['tagger', 'model-a'],
      ['queryTranslator', 'model-a'],
      ['generator', 'model-b'],
    ]);
  });

  it('makes no network call when every role is fake', async () => {
    const { requestModels } = await modelsUsed({ LLM_PROVIDER: 'fake' });

    expect(requestModels).toEqual([]);
  });
});
