import { describe, expect, it } from 'vitest';
import { loadJudgeConfig } from './config.js';

const JEV_KEY = { JEV_API_KEY: 'jev-key' };

describe('loadJudgeConfig', () => {
  it('defaults to JEV with the LLM as fallback, threshold 0.5 and a 10 s JEV timeout', () => {
    expect(loadJudgeConfig(JEV_KEY)).toEqual({
      impl: 'jev-with-fallback',
      threshold: 0.5,
      jev: {
        apiKey: 'jev-key',
        baseUrl: 'https://api.typesafe.ai/v1',
        model: 'jev-latest',
        timeoutMs: 10_000,
      },
    });
  });

  it('judges with the LLM and warns when the default has no JEV key', () => {
    expect(loadJudgeConfig({})).toEqual({
      impl: 'llm',
      threshold: 0.5,
      warning: expect.stringContaining('JEV_API_KEY is not set'),
    });
  });

  it('reads the implementation, threshold and timeout', () => {
    expect(
      loadJudgeConfig({
        ...JEV_KEY,
        JUDGE_IMPL: 'jev',
        JUDGE_THRESHOLD: '0.65',
        JUDGE_TIMEOUT_MS: '2500',
        JEV_TIMEOUT_MS: '30000',
      }),
    ).toMatchObject({ impl: 'jev', threshold: 0.65, jev: { timeoutMs: 2500 } });
    expect(loadJudgeConfig({ JUDGE_IMPL: 'llm', JUDGE_THRESHOLD: '0.3' })).toEqual({
      impl: 'llm',
      threshold: 0.3,
    });
  });

  it.each([
    [{ JUDGE_IMPL: 'jev' }, 'JEV_API_KEY is required because JUDGE_IMPL is jev'],
    [
      { JUDGE_IMPL: 'judge' },
      'Invalid JUDGE_IMPL "judge": expected jev or llm or jev-with-fallback',
    ],
    [{ JUDGE_THRESHOLD: '1.5' }, 'Invalid JUDGE_THRESHOLD "1.5": expected a number from 0 to 1'],
    [{ JUDGE_THRESHOLD: 'high' }, 'Invalid JUDGE_THRESHOLD "high"'],
    [{ JUDGE_TIMEOUT_MS: '0' }, 'Invalid JUDGE_TIMEOUT_MS "0"'],
    [{ ...JEV_KEY, JUDGE_IMPL: 'jev', JEV_TIMEOUT_MS: 'abc' }, 'Invalid JEV_TIMEOUT_MS "abc"'],
  ])('rejects %o', (env, message) => {
    expect(() => loadJudgeConfig({ ...env })).toThrow(message);
  });
});
