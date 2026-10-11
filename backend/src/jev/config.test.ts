import { describe, expect, it } from 'vitest';
import { loadJevConfig } from './config.js';

describe('loadJevConfig', () => {
  it('uses the defaults next to the key', () => {
    expect(loadJevConfig({ JEV_API_KEY: ' key ' }, 'x')).toEqual({
      apiKey: 'key',
      baseUrl: 'https://api.typesafe.ai/v1',
      model: 'jev-latest',
      timeoutMs: 30000,
    });
  });

  it('reads the base URL without a trailing slash, the model and the timeout', () => {
    expect(
      loadJevConfig(
        {
          JEV_API_KEY: 'key',
          JEV_BASE_URL: 'https://jev.example/v2/',
          JEV_MODEL: 'jev-1.13.0',
          JEV_TIMEOUT_MS: '5000',
        },
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
    expect(() => loadJevConfig(env, 'the judge uses JEV')).toThrow(message);
  });
});
