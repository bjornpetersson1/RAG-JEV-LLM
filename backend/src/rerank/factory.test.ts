import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../db/test-helpers.js';
import { loadLlmConfig } from '../llm/config.js';
import { createCapturingLogger } from '../llm/test-helpers.js';
import { createReranker, isRemoteReranker, loadRerankerConfig, RERANKERS } from './factory.js';
import { fakeRerankResult } from './test-helpers.js';
import type { RerankerEntry } from './types.js';

const JEV_KEY = { JEV_API_KEY: 'jev-key' };

let database: ReturnType<typeof createTestDatabase> | undefined;

afterEach(() => {
  database?.remove();
  database = undefined;
});

function deps() {
  database = createTestDatabase('rerank-');
  return {
    db: database.db,
    llmConfig: loadLlmConfig({ LLM_PROVIDER: 'fake' }),
    logger: createCapturingLogger(),
  };
}

describe('loadRerankerConfig', () => {
  it('defaults to the LLM judge keeping 8 chunks', () => {
    expect(loadRerankerConfig({})).toEqual({ name: 'llm', topK: 8 });
  });

  it.each(['bge', 'jev', 'llm', 'minilm', 'qwen3', 'subq'])('accepts RERANKER=%s', (name) => {
    expect(
      loadRerankerConfig({ ...JEV_KEY, SUBQ_API_KEY: 'k', RERANKER: name, RERANK_TOP_K: '5' }),
    ).toEqual({
      name,
      topK: 5,
    });
  });

  it.each([
    [
      { RERANKER: 'foo' },
      'Invalid RERANKER "foo": expected bge or minilm or jev or llm or qwen3 or subq',
    ],
    [{ RERANKER: 'jev' }, 'JEV_API_KEY is required because RERANKER is jev'],
    [{ RERANKER: 'subq', ...JEV_KEY }, 'SUBQ_API_KEY is required because RERANKER is subq'],
    [{ RERANK_TOP_K: '0' }, 'Invalid RERANK_TOP_K "0"'],
    [
      { JUDGE_IMPL: 'llm' },
      'JUDGE_IMPL was replaced by RERANKER (bge, minilm, jev, llm, qwen3, subq); remove JUDGE_IMPL from .env',
    ],
    [{ RERANKER: 'llm', JUDGE_THRESHOLD: '2' }, 'Invalid JUDGE_THRESHOLD "2"'],
    [{ RERANKER: 'llm', JUDGE_CACHE: 'maybe' }, 'Invalid JUDGE_CACHE "maybe"'],
  ])('rejects %o', (env, message) => {
    expect(() => loadRerankerConfig(env)).toThrow(message);
  });
});

describe('createReranker', () => {
  it.each([
    [{ RERANKER: 'jev', ...JEV_KEY }, 'jev', 'jev-latest'],
    [{ RERANKER: 'subq', SUBQ_API_KEY: 'k' }, 'subq', 'subq-snap-preview'],
    [{}, 'llm', 'fake'],
    [{ RERANKER: 'bge' }, 'bge', 'onnx-community/bge-reranker-v2-m3-ONNX'],
    [{ RERANKER: 'minilm' }, 'minilm', 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'],
    [{ RERANKER: 'qwen3' }, 'qwen3', 'Qwen3-Reranker'],
  ])('builds %o from .env alone', (env, name, model) => {
    const { reranker, topK } = createReranker(env, deps());

    expect(reranker).toMatchObject({ name, model });
    expect(topK).toBe(8);
  });

  it.each(['qwen3'])('builds the %s placeholder, which throws when used', async (name) => {
    const { reranker } = createReranker({ RERANKER: name }, deps());

    await expect(reranker.rerank('x', [{ id: '1', text: 'a' }], 8)).rejects.toThrow(
      `RERANKER=${name} is not implemented yet`,
    );
  });

  it('adds a reranker with one registry entry and no other change', async () => {
    const fake: RerankerEntry = {
      remote: false,
      validate() {},
      create: () => ({
        name: 'fake',
        model: 'fake-model',
        rerank: async (_query, chunks, topK) => fakeRerankResult(chunks, { a: 0.9 }, { topK }),
      }),
    };
    const registry = { ...RERANKERS, fake };

    const { reranker } = createReranker({ RERANKER: 'fake' }, deps(), registry);
    const result = await reranker.rerank('x', [{ id: 'a', text: 'A' }], 8);

    expect(reranker.name).toBe('fake');
    expect(result.ranked.map(({ chunk }) => chunk.id)).toEqual(['a']);
  });
});

describe('isRemoteReranker', () => {
  it.each([
    ['llm', true],
    ['jev', true],
    ['subq', true],
    ['bge', false],
    ['minilm', false],
    ['qwen3', false],
    ['unregistered', false],
  ])('says whether %s calls a remote model: %s', (name, remote) => {
    expect(isRemoteReranker({ name })).toBe(remote);
  });
});
