// Every reranker returns the same `ScoredChunk` shape: scores in [0, 1], best first, at most topK.

import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../db/test-helpers.js';
import { loadLlmConfig } from '../llm/config.js';
import { createCapturingLogger, messageResponse } from '../llm/test-helpers.js';
import type { Chunk } from '../llm/types.js';
import { createBgeReranker, loadBgeRerankerConfig } from './bge-reranker.js';
import { createReranker } from './factory.js';
import { fakeRerankResult } from './test-helpers.js';
import type { Reranker, RerankerDependencies } from './types.js';

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

/** Each chunk's score, from JEV and from the LLM alike; `d` is below the 0.5 threshold. */
const SCORES: Record<string, number> = { a: 0.6, b: 0.95, c: 0.8, d: 0.1, e: 0.7 };
const CHUNKS: Chunk[] = Object.keys(SCORES).map((id) => ({ id, text: `Text ${id}` }));

/** The score of the chunk whose text the request body mentions. */
function scoreIn(body: string): number {
  const id = Object.keys(SCORES).find((key) => body.includes(`Text ${key}`));
  if (!id) throw new Error(`No chunk in ${body}`);
  return SCORES[id];
}

/** Answers JEV with a Noul and the Anthropic API with a score, both read from `SCORES`. */
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const score = scoreIn(String(init?.body));
  return String(url) === JEV_URL
    ? Response.json({ answers: { relevant: { type: 'noul', noul: score } }, usage: {} })
    : messageResponse({ score });
}) as typeof globalThis.fetch;

let database: ReturnType<typeof createTestDatabase> | undefined;

afterEach(() => {
  database?.remove();
  database = undefined;
});

function deps(): RerankerDependencies {
  database = createTestDatabase('rerank-contract-');
  return {
    db: database.db,
    llmConfig: loadLlmConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-haiku-5-5',
      ANTHROPIC_API_KEY: 'a',
    }),
    logger: createCapturingLogger(),
    fetch: fakeFetch,
  };
}

/** A cross-encoder whose logit for a pair gives the passage's score in `SCORES`. */
const fakeCrossEncoder = async () => async (pairs: readonly { passage: string }[]) =>
  pairs.map(({ passage }) => {
    const score = scoreIn(passage);
    return { logit: Math.log(score / (1 - score)), truncated: false };
  });

/** A reranker outside the registry, scoring from `SCORES` without any call. */
const fakeReranker: Reranker = {
  name: 'fake',
  model: 'fake-model',
  rerank: async (_query, chunks, topK) => fakeRerankResult(chunks, SCORES, { topK }),
};

const RERANKERS: [string, () => Reranker, string][] = [
  [
    'jev',
    () => createReranker({ RERANKER: 'jev', JEV_API_KEY: 'k' }, deps()).reranker,
    'jev-latest',
  ],
  ['llm', () => createReranker({ RERANKER: 'llm' }, deps()).reranker, 'claude-haiku-5-5'],
  // The model is faked: its logit for a chunk is the one whose sigmoid is the chunk's score.
  [
    'bge',
    () =>
      createBgeReranker(
        loadBgeRerankerConfig({ RERANK_THRESHOLD_BGE: '0.5' }),
        createCapturingLogger(),
        fakeCrossEncoder,
      ),
    'onnx-community/bge-reranker-v2-m3-ONNX',
  ],
  ['fake', () => fakeReranker, 'fake-model'],
];

describe.each(RERANKERS)('the %s reranker', (name, build, model) => {
  it('returns the relevant chunks best first, scores in [0, 1], at most topK', async () => {
    const result = await build().rerank('Anställningsavtal', CHUNKS, 3);

    expect(result.ranked.map(({ chunk }) => chunk.id)).toEqual(['b', 'c', 'e']);
    for (const scored of result.ranked) {
      expect(scored.score).toBeGreaterThanOrEqual(0);
      expect(scored.score).toBeLessThanOrEqual(1);
      expect(scored).toMatchObject({ reranker: name, model });
    }
  });

  it('keeps every relevant chunk when topK allows, and scores every chunk', async () => {
    const result = await build().rerank('Anställningsavtal', CHUNKS, CHUNKS.length);

    expect(result.ranked.map(({ chunk }) => chunk.id)).toEqual(['b', 'c', 'e', 'a']);
    const expected = [0.95, 0.8, 0.7, 0.6, 0.1];
    // BGE's scores come back through a sigmoid of the fake logit, so they are equal to rounding.
    expect(result.scored.map(({ score }) => score)).toEqual(
      name === 'bge' ? expected.map((score) => expect.closeTo(score, 10)) : expected,
    );
  });
});

describe('the judge-based rerankers', () => {
  it('report the calls and which judge answered', async () => {
    const { reranker } = createReranker(
      { RERANKER: 'jev', JEV_API_KEY: 'k', JUDGE_CACHE: 'off' },
      deps(),
    );

    const result = await reranker.rerank('Anställningsavtal', CHUNKS, 8);

    expect(result.stats).toMatchObject({ calls: 5, cacheHits: 0, unknown: 0 });
    expect(result.scored.every(({ answeredBy }) => answeredBy === 'jev')).toBe(true);
  });

  it('reuse cached scores on a second rerank', async () => {
    const { reranker } = createReranker({ RERANKER: 'llm' }, deps());

    await reranker.rerank('Anställningsavtal', CHUNKS, 8);
    const again = await reranker.rerank('Anställningsavtal', CHUNKS, 8);

    expect(again.stats).toMatchObject({ calls: 0, cacheHits: 5 });
    expect(again.ranked.map(({ chunk }) => chunk.id)).toEqual(['b', 'c', 'e', 'a']);
  });

  it('name the LLM model for a chunk the LLM scored because JEV failed', async () => {
    const failingJev = (async (url: string | URL | Request, init?: RequestInit) =>
      String(url) === JEV_URL
        ? new Response('down', { status: 500 })
        : fakeFetch(url, init)) as typeof globalThis.fetch;
    const { reranker } = createReranker(
      { RERANKER: 'jev', JEV_API_KEY: 'k' },
      { ...deps(), fetch: failingJev },
    );

    const result = await reranker.rerank('Anställningsavtal', CHUNKS, 8);

    expect(result.scored[0]).toMatchObject({
      reranker: 'jev',
      model: 'claude-haiku-5-5',
      answeredBy: 'llm',
    });
  });

  it('count the relevant chunks before topK cuts them', async () => {
    const { reranker } = createReranker({ RERANKER: 'llm' }, deps());

    const result = await reranker.rerank('Anställningsavtal', CHUNKS, 2);

    expect(result.ranked).toHaveLength(2);
    expect(result.stats.relevant).toBe(4);
  });
});
