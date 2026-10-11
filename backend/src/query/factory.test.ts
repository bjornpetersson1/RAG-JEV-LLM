import { describe, expect, it } from 'vitest';
import { createFakeQueryTranslator } from '../llm/fakes.js';
import { createCapturingLogger } from '../llm/test-helpers.js';
import { loadQueryTranslatorConfig } from './config.js';
import { createQueryTranslator } from './factory.js';
import { createFakeJev, VOCABULARY } from './test-helpers.js';

describe('createQueryTranslator', () => {
  it('builds the implementation QUERY_TRANSLATOR_IMPL names', async () => {
    const llmTranslator = createFakeQueryTranslator(() => ['bonus']);
    const jev = createFakeJev({ sekretess: 1 }, { sekretessklausul: 0.9 });
    const deps = { llmTranslator, logger: createCapturingLogger(), fetch: jev.fetch };

    const llm = createQueryTranslator(loadQueryTranslatorConfig({}), deps);
    const viaJev = createQueryTranslator(
      loadQueryTranslatorConfig({ QUERY_TRANSLATOR_IMPL: 'jev', JEV_API_KEY: 'k' }),
      deps,
    );

    expect(llm).toBe(llmTranslator);
    await expect(viaJev.translate('NDA', VOCABULARY)).resolves.toMatchObject({
      tags: [{ slug: 'sekretessklausul', score: 0.9 }],
    });
    expect(jev.requests[0].url).toBe('https://api.typesafe.ai/v1/systemone');
  });
});
