import { describe, expect, it } from 'vitest';
import { loadQueryTranslatorConfig } from './config.js';

describe('loadQueryTranslatorConfig', () => {
  it('defaults to the LLM translator, which needs no JEV key', () => {
    expect(loadQueryTranslatorConfig({})).toEqual({ impl: 'llm' });
  });

  it('reads the JEV translator with its threshold and JEV settings', () => {
    expect(
      loadQueryTranslatorConfig({
        QUERY_TRANSLATOR_IMPL: 'jev',
        QUERY_TRANSLATOR_THRESHOLD: '0.7',
        JEV_API_KEY: 'key',
      }),
    ).toEqual({
      impl: 'jev',
      threshold: 0.7,
      systemOne: {
        apiKey: 'key',
        baseUrl: 'https://api.typesafe.ai/v1',
        model: 'jev-latest',
        timeoutMs: 30000,
      },
    });
    expect(
      loadQueryTranslatorConfig({ QUERY_TRANSLATOR_IMPL: 'jev', JEV_API_KEY: 'k' }),
    ).toMatchObject({
      threshold: 0.5,
    });
  });

  it('reads the SubQ translator with the SubQ settings', () => {
    expect(
      loadQueryTranslatorConfig({ QUERY_TRANSLATOR_IMPL: 'subq', SUBQ_API_KEY: 'key' }),
    ).toEqual({
      impl: 'subq',
      threshold: 0.5,
      systemOne: {
        apiKey: 'key',
        baseUrl: 'https://api.subq.ai/v1',
        model: 'subq-snap-preview',
        timeoutMs: 30000,
      },
    });
  });

  it.each([
    [
      { QUERY_TRANSLATOR_IMPL: 'gpt' },
      'Invalid QUERY_TRANSLATOR_IMPL "gpt": expected llm or jev or subq',
    ],
    [
      { QUERY_TRANSLATOR_IMPL: 'jev' },
      'JEV_API_KEY is required because QUERY_TRANSLATOR_IMPL is jev',
    ],
    [
      { QUERY_TRANSLATOR_IMPL: 'subq', JEV_API_KEY: 'k' },
      'SUBQ_API_KEY is required because QUERY_TRANSLATOR_IMPL is subq',
    ],
    [
      { QUERY_TRANSLATOR_THRESHOLD: '1.5' },
      'Invalid QUERY_TRANSLATOR_THRESHOLD "1.5": expected a number from 0 to 1',
    ],
  ])('rejects %o', (env, message) => {
    expect(() => loadQueryTranslatorConfig(env)).toThrow(message);
  });
});
