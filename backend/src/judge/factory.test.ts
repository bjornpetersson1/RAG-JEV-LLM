import { describe, expect, it } from 'vitest';
import { loadLlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { createCapturingLogger, createFakeFetch, messageResponse } from '../llm/test-helpers.js';
import { loadJudgeConfig, type JudgeImpl } from './config.js';
import { createJudge, createJudging } from './factory.js';

const CHUNK = { id: 'c7', text: 'Uppsägningstiden är en månad.', source: 'SFS 1982:80 11 §' };
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

/**
 * Builds the judge from `env` alone, as the app will, with one fake `fetch` for both JEV and the
 * Anthropic API: JEV answers with `jev`, the LLM with a score of 0.3.
 */
function judgeFrom(
  env: Record<string, string>,
  jev: (init: RequestInit | undefined) => Response | Error | Promise<Response>,
  impl: JudgeImpl = 'jev',
) {
  const anthropic = createFakeFetch(() => messageResponse({ score: 0.3 }));
  const urls: string[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    if (String(url) !== JEV_URL) return anthropic.fetch(url, init);
    const result = await jev(init);
    if (result instanceof Error) throw result;
    return result;
  }) as typeof globalThis.fetch;
  const logger = createCapturingLogger();
  const config = loadJudgeConfig(env, impl);
  const llmJudge = createLlmRoles(
    loadLlmConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-haiku-5-5',
      ANTHROPIC_API_KEY: 'a',
      ...env,
    }),
    { logger, fetch },
  ).judge;
  return { judge: createJudge(config, { llmJudge, logger, fetch }), urls, logger };
}

const jevAnswers = (noul: number) => () =>
  Response.json({ answers: { relevant: { type: 'noul', noul } }, usage: {} });

/** A JEV that never answers, failing only when the call's signal aborts (e.g. its timeout). */
function hangingJev(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });
}

describe('createJudge', () => {
  it('uses JEV for jev', async () => {
    const { judge, urls } = judgeFrom({ JEV_API_KEY: 'k' }, jevAnswers(0.9));

    await expect(judge.judge('Anställningsavtal', CHUNK)).resolves.toMatchObject({
      relevant: true,
      score: 0.9,
      judgedBy: 'jev',
    });
    expect(urls).toEqual([JEV_URL]);
  });

  it('uses the LLM without calling JEV for llm, even with a JEV key', async () => {
    const { judge, urls } = judgeFrom({ JEV_API_KEY: 'k' }, jevAnswers(0.9), 'llm');

    await expect(judge.judge('Anställningsavtal', CHUNK)).resolves.toMatchObject({
      relevant: false,
      score: 0.3,
      judgedBy: 'llm',
    });
    expect(urls).not.toContain(JEV_URL);
  });

  it.each([
    ['0.31', false],
    ['0.3', true],
    ['0.29', true],
  ])(
    'with the LLM and JUDGE_THRESHOLD %s, score 0.3 is relevant: %s',
    async (threshold, relevant) => {
      const { judge } = judgeFrom({ JUDGE_THRESHOLD: threshold }, jevAnswers(0), 'llm');

      await expect(judge.judge('x', CHUNK)).resolves.toMatchObject({ relevant, score: 0.3 });
    },
  );

  it.each([
    ['0.71', false],
    ['0.7', true],
    ['0.69', true],
  ])('with JEV and JUDGE_THRESHOLD %s, score 0.7 is relevant: %s', async (threshold, relevant) => {
    const { judge } = judgeFrom({ JEV_API_KEY: 'k', JUDGE_THRESHOLD: threshold }, jevAnswers(0.7));

    await expect(judge.judge('x', CHUNK)).resolves.toMatchObject({
      relevant,
      score: 0.7,
      judgedBy: 'jev',
    });
  });

  it('applies the threshold to a fallback answer too', async () => {
    const { judge } = judgeFrom(
      { JEV_API_KEY: 'k', JUDGE_THRESHOLD: '0.25' },
      () => new Response('down', { status: 500 }),
    );

    await expect(judge.judge('x', CHUNK)).resolves.toMatchObject({
      relevant: true,
      score: 0.3,
      judgedBy: 'llm',
    });
  });

  it.each([
    ['an HTTP 500', () => new Response('down', { status: 500 }), 'http'],
    ['an HTTP 429', () => new Response('slow down', { status: 429 }), 'http'],
    ['a timeout', () => new DOMException('timed out', 'TimeoutError'), 'timeout'],
    ['a network error', () => new TypeError('fetch failed'), 'network'],
    ['a malformed response', () => Response.json({ answers: {} }), 'response'],
  ])('falls back to the LLM on %s and logs a warning', async (_case, jev, kind) => {
    const { judge, urls, logger } = judgeFrom({ JEV_API_KEY: 'k' }, jev);

    await expect(judge.judge('Anställningsavtal', CHUNK)).resolves.toMatchObject({
      score: 0.3,
      judgedBy: 'llm',
    });
    expect(urls[0]).toBe(JEV_URL);
    expect(urls).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'judge', chunkId: 'c7', kind, error: expect.any(String) }),
      'JEV failed, judging with the LLM instead',
    );
  });

  it('falls back when JEV is slower than JUDGE_TIMEOUT_MS', async () => {
    const { judge, logger } = judgeFrom({ JEV_API_KEY: 'k', JUDGE_TIMEOUT_MS: '20' }, hangingJev);

    await expect(judge.judge('x', CHUNK)).resolves.toMatchObject({ judgedBy: 'llm' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timeout', error: 'JEV did not answer within 20 ms' }),
      expect.any(String),
    );
  });

  it('rethrows a cancelled JEV call instead of asking the LLM', async () => {
    const { judge, urls } = judgeFrom(
      { JEV_API_KEY: 'k' },
      () => new DOMException('cancelled', 'AbortError'),
    );

    await expect(judge.judge('x', CHUNK)).rejects.toMatchObject({ kind: 'aborted' });
    expect(urls).toEqual([JEV_URL]);
  });

  it('throws the LLM error when the fallback fails too', async () => {
    const judge = createJudge(loadJudgeConfig({ JEV_API_KEY: 'k' }, 'jev'), {
      llmJudge: { judge: () => Promise.reject(new Error('LLM down')) },
      logger: createCapturingLogger(),
      fetch: (async () => new Response('down', { status: 500 })) as typeof globalThis.fetch,
    });

    await expect(judge.judge('x', CHUNK)).rejects.toThrow('LLM down');
  });

  it('builds the judging for judgeAll: JEV keyed by the JEV model, else the LLM by its model', async () => {
    const llmConfig = loadLlmConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-opus-5-5',
      LLM_JUDGE_MODEL: 'claude-haiku-5-5',
      ANTHROPIC_API_KEY: 'a',
    });
    const anthropic = createFakeFetch(() => messageResponse({ score: 0.4 }));
    const deps = { llmConfig, logger: createCapturingLogger(), fetch: anthropic.fetch };

    const jev = createJudging(
      loadJudgeConfig({ JEV_API_KEY: 'k', JUDGE_THRESHOLD: '0.6' }, 'jev'),
      deps,
    );
    const llm = createJudging(loadJudgeConfig({}, 'llm'), deps);

    expect(jev).toMatchObject({ primary: { impl: 'jev', model: 'jev-latest' }, threshold: 0.6 });
    expect(llm).toMatchObject({
      primary: { impl: 'llm', model: 'claude-haiku-5-5' },
      threshold: 0.5,
    });
    await expect(llm.judge.judge('x', CHUNK)).resolves.toMatchObject({
      score: 0.4,
      judgedBy: 'llm',
    });
    expect(anthropic.requests[0].body.model).toBe('claude-haiku-5-5');
  });
});
