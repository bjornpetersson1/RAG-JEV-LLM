import { describe, expect, it } from 'vitest';
import { hasSystemOneKey, loadSystemOneConfig } from './config.js';

describe('loadSystemOneConfig', () => {
  it('uses the defaults next to the key', () => {
    expect(loadSystemOneConfig({ JEV_API_KEY: ' key ' }, 'jev', 'x')).toEqual({
      apiKey: 'key',
      baseUrl: 'https://api.typesafe.ai/v1',
      model: 'jev-latest',
      timeoutMs: 30000,
    });
  });

  it('reads the base URL without a trailing slash, the model and the timeout', () => {
    expect(
      loadSystemOneConfig(
        {
          JEV_API_KEY: 'key',
          JEV_BASE_URL: 'https://jev.example/v2/',
          JEV_MODEL: 'jev-1.13.0',
          JEV_TIMEOUT_MS: '5000',
        },
        'jev',
        'x',
      ),
    ).toEqual({
      apiKey: 'key',
      baseUrl: 'https://jev.example/v2',
      model: 'jev-1.13.0',
      timeoutMs: 5000,
    });
  });

  it.each([
    [{}, 'JEV_API_KEY is required because the judge uses JEV'],
    [
      { JEV_API_KEY: 'key', JEV_BASE_URL: 'not a url' },
      'Invalid JEV_BASE_URL "not a url": expected a URL',
    ],
    [
      { JEV_API_KEY: 'key', JEV_TIMEOUT_MS: '2147483648' },
      'Invalid JEV_TIMEOUT_MS "2147483648": expected an integer from 1 to 2147483647',
    ],
    [
      { JEV_API_KEY: 'key', JEV_TIMEOUT_MS: '0' },
      'Invalid JEV_TIMEOUT_MS "0": expected an integer from 1 to 2147483647',
    ],
  ])('rejects %o', (env, message) => {
    expect(() => loadSystemOneConfig(env, 'jev', 'the judge uses JEV')).toThrow(message);
  });

  it('reads SubQ from its own settings, with its defaults', () => {
    const env = { JEV_API_KEY: 'jev-key', SUBQ_API_KEY: 'subq-key' };
    expect(loadSystemOneConfig(env, 'subq', 'x')).toEqual({
      apiKey: 'subq-key',
      baseUrl: 'https://api.subq.ai/v1',
      model: 'subq-snap-preview',
      timeoutMs: 30000,
    });
    expect(
      loadSystemOneConfig(
        {
          SUBQ_API_KEY: 'key',
          SUBQ_BASE_URL: 'https://subq.example/v1/',
          SUBQ_MODEL: 'subq-snap',
          SUBQ_TIMEOUT_MS: '4000',
        },
        'subq',
        'x',
      ),
    ).toEqual({
      apiKey: 'key',
      baseUrl: 'https://subq.example/v1',
      model: 'subq-snap',
      timeoutMs: 4000,
    });
  });

  it.each([
    [{ JEV_API_KEY: 'key' }, 'SUBQ_API_KEY is required because RERANKER is subq'],
    [
      { SUBQ_API_KEY: 'key', SUBQ_BASE_URL: 'not a url' },
      'Invalid SUBQ_BASE_URL "not a url": expected a URL',
    ],
    [
      { SUBQ_API_KEY: 'key', SUBQ_TIMEOUT_MS: '0' },
      'Invalid SUBQ_TIMEOUT_MS "0": expected an integer from 1 to 2147483647',
    ],
  ])('rejects SubQ settings %o', (env, message) => {
    expect(() => loadSystemOneConfig(env, 'subq', 'RERANKER is subq')).toThrow(message);
  });

  it('tells whether a provider has a key', () => {
    const env = { SUBQ_API_KEY: ' key ', JEV_API_KEY: ' ' };
    expect(hasSystemOneKey(env, 'subq')).toBe(true);
    expect(hasSystemOneKey(env, 'jev')).toBe(false);
  });
});
