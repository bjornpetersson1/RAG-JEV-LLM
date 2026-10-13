import { describe, expect, it } from 'vitest';
import { loadJudgeConfig, loadJudgingConfig } from './config.js';

const JEV_KEY = { JEV_API_KEY: 'jev-key' };

describe('loadJudgeConfig', () => {
  it('reads JEV with threshold 0.5 and a 10 s JEV timeout by default', () => {
    expect(loadJudgeConfig(JEV_KEY, 'jev')).toEqual({
      impl: 'jev',
      threshold: 0.5,
      jev: {
        apiKey: 'jev-key',
        baseUrl: 'https://api.typesafe.ai/v1',
        model: 'jev-latest',
        timeoutMs: 10_000,
      },
    });
  });

  it('reads the threshold and timeout', () => {
    expect(
      loadJudgeConfig(
        {
          ...JEV_KEY,
          JUDGE_THRESHOLD: '0.65',
          JUDGE_TIMEOUT_MS: '2500',
          JEV_TIMEOUT_MS: '30000',
        },
        'jev',
      ),
    ).toMatchObject({ impl: 'jev', threshold: 0.65, jev: { timeoutMs: 2500 } });
    expect(loadJudgeConfig({ JUDGE_THRESHOLD: '0.3' }, 'llm')).toEqual({
      impl: 'llm',
      threshold: 0.3,
    });
  });

  it('needs no JEV key for the LLM', () => {
    expect(loadJudgeConfig({}, 'llm')).toEqual({ impl: 'llm', threshold: 0.8 });
  });

  it.each([
    [{}, 'jev', 'JEV_API_KEY is required because RERANKER is jev'],
    [
      { JUDGE_THRESHOLD: '1.5' },
      'llm',
      'Invalid JUDGE_THRESHOLD "1.5": expected a number from 0 to 1',
    ],
    [{ JUDGE_THRESHOLD: 'high' }, 'llm', 'Invalid JUDGE_THRESHOLD "high"'],
    [{ JUDGE_TIMEOUT_MS: '0' }, 'llm', 'Invalid JUDGE_TIMEOUT_MS "0"'],
    [{ ...JEV_KEY, JEV_TIMEOUT_MS: 'abc' }, 'jev', 'Invalid JEV_TIMEOUT_MS "abc"'],
  ] as const)('rejects %o for %s', (env, impl, message) => {
    expect(() => loadJudgeConfig({ ...env }, impl)).toThrow(message);
  });
});

describe('loadJudgingConfig', () => {
  it('defaults to 8 calls at a time, 30 s per chunk, 60 s in total and the cache on', () => {
    expect(loadJudgingConfig({})).toEqual({
      concurrency: 8,
      chunkTimeoutMs: 30_000,
      totalTimeoutMs: 60_000,
      cache: true,
    });
  });

  it('reads every setting', () => {
    expect(
      loadJudgingConfig({
        JUDGE_CONCURRENCY: '3',
        JUDGE_CHUNK_TIMEOUT_MS: '5000',
        JUDGE_TOTAL_TIMEOUT_MS: '20000',
        JUDGE_CACHE: 'off',
      }),
    ).toEqual({ concurrency: 3, chunkTimeoutMs: 5000, totalTimeoutMs: 20_000, cache: false });
  });

  it.each([
    [{ JUDGE_CONCURRENCY: '0' }, 'Invalid JUDGE_CONCURRENCY "0"'],
    [{ JUDGE_CHUNK_TIMEOUT_MS: 'soon' }, 'Invalid JUDGE_CHUNK_TIMEOUT_MS "soon"'],
    [{ JUDGE_TOTAL_TIMEOUT_MS: '-1' }, 'Invalid JUDGE_TOTAL_TIMEOUT_MS "-1"'],
    [{ JUDGE_CACHE: 'yes' }, 'Invalid JUDGE_CACHE "yes": expected on or off'],
  ])('rejects %o', (env, message) => {
    expect(() => loadJudgingConfig({ ...env })).toThrow(message);
  });
});
