import { describe, expect, it, vi } from 'vitest';
import { createCapturingLogger } from '../llm/test-helpers.js';
import type { Chunk } from '../llm/types.js';
import { BGE_RERANKER_MAX_TOKENS } from '../models/catalog.js';
import {
  createBgeReranker,
  loadBgeRerankerConfig,
  sigmoid,
  type BgeRerankerConfig,
} from './bge-reranker.js';

const CONFIG: BgeRerankerConfig = {
  dtype: 'int8',
  cacheDir: '/models',
  batchSize: 2,
  threshold: 0,
};

const CHUNKS: Chunk[] = [
  { id: 'a', text: 'Text a', source: 'SFS 1982:80 1 §', context: 'LAS › 1 §' },
  { id: 'b', text: 'Text b', source: 'SFS 1982:80 2 §' },
  { id: 'c', text: 'Text c', source: 'SFS 1982:80 3 §', context: 'LAS › 3 §' },
];

/** Logits per chunk text; the model records each batch of pairs it gets. */
function fakeModel(logits: Record<string, number>, truncate: string[] = []) {
  const batches: { query: string; passage: string }[][] = [];
  const load = vi.fn(async () => async (pairs: readonly { query: string; passage: string }[]) => {
    batches.push([...pairs]);
    return pairs.map(({ passage }) => {
      const id = Object.keys(logits).find((key) => passage.endsWith(`Text ${key}`))!;
      return { logit: logits[id], truncated: truncate.includes(id) };
    });
  });
  return { load, batches };
}

describe('createBgeReranker', () => {
  it('turns logits into scores with a sigmoid and ranks best first, at most topK', async () => {
    const { load } = fakeModel({ a: -1, b: 2, c: 0 });
    const reranker = createBgeReranker(CONFIG, createCapturingLogger(), load);

    const result = await reranker.rerank('Uppsägning', CHUNKS, 2);

    expect(result.ranked.map(({ chunk }) => chunk.id)).toEqual(['b', 'c']);
    expect(result.scored.map(({ score }) => score)).toEqual([sigmoid(2), 0.5, sigmoid(-1)]);
    expect(result.stats).toMatchObject({ calls: 3, cacheHits: 0, unknown: 0, relevant: 3 });
    expect(result.ranked[0]).toMatchObject({
      reranker: 'bge',
      model: 'onnx-community/bge-reranker-v2-m3-ONNX',
    });
  });

  it('applies RERANK_THRESHOLD_BGE before topK', async () => {
    const { load } = fakeModel({ a: -1, b: 2, c: 0 });
    const reranker = createBgeReranker(
      { ...CONFIG, threshold: 0.6 },
      createCapturingLogger(),
      load,
    );

    const result = await reranker.rerank('Uppsägning', CHUNKS, 8);

    expect(result.ranked.map(({ chunk }) => chunk.id)).toEqual(['b']);
    expect(result.stats.relevant).toBe(1);
  });

  it('scores the heading path and text, or the source and text, in batches of similar length', async () => {
    const { load, batches } = fakeModel({ a: 0, b: 0, c: 0 });
    const reranker = createBgeReranker(CONFIG, createCapturingLogger(), load);

    await reranker.rerank('Uppsägning', CHUNKS, 8);

    expect(batches).toEqual([
      [
        { query: 'Uppsägning', passage: 'LAS › 1 §\nText a' },
        { query: 'Uppsägning', passage: 'LAS › 3 §\nText c' },
      ],
      [{ query: 'Uppsägning', passage: 'SFS 1982:80 2 §\n\nText b' }],
    ]);
  });

  it('loads the model once, on the first rerank with chunks, and logs the load', async () => {
    const { load } = fakeModel({ a: 0, b: 0, c: 0 });
    const logger = createCapturingLogger();
    const reranker = createBgeReranker(CONFIG, logger, load);

    await expect(reranker.rerank('x', [], 8)).resolves.toMatchObject({ ranked: [], scored: [] });
    expect(load).not.toHaveBeenCalled();
    await reranker.rerank('x', CHUNKS, 8);
    await reranker.rerank('x', CHUNKS, 8);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('onnx-community/bge-reranker-v2-m3-ONNX', 'int8', '/models');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'reranker', loadMs: expect.any(Number) }),
      'Reranker model loaded',
    );
  });

  it('tries to load again after a failed load', async () => {
    const { load } = fakeModel({ a: 0, b: 0, c: 0 });
    load.mockRejectedValueOnce(new Error('download failed'));
    const reranker = createBgeReranker(CONFIG, createCapturingLogger(), load);

    await expect(reranker.rerank('x', CHUNKS, 8)).rejects.toThrow('download failed');
    await expect(reranker.rerank('x', CHUNKS, 8)).resolves.toMatchObject({
      stats: { calls: 3 },
    });
  });

  it('spells out law abbreviations in the instruction', async () => {
    const { load, batches } = fakeModel({ a: 0, b: 0, c: 0 });
    const reranker = createBgeReranker(CONFIG, createCapturingLogger(), load);

    await reranker.rerank('Uppsägning enligt 7 § LAS', CHUNKS.slice(0, 1), 8);

    expect(batches[0][0].query).toBe(
      'Uppsägning enligt 7 § LAS (Lag (1982:80) om anställningsskydd)',
    );
  });

  it('leaves the chunks of a failed batch unknown and keeps the rest', async () => {
    const logger = createCapturingLogger();
    let calls = 0;
    const load = vi.fn(async () => async (pairs: readonly { passage: string }[]) => {
      calls += 1;
      if (calls === 1) throw new Error('out of memory');
      return pairs.map(() => ({ logit: 1, truncated: false }));
    });
    const reranker = createBgeReranker(CONFIG, logger, load);

    const result = await reranker.rerank('x', CHUNKS, 8);

    expect(result.scored.map(({ chunk }) => chunk.id)).toEqual(['b']);
    expect(result.stats).toMatchObject({ calls: 3, unknown: 2, relevant: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIds: ['a', 'c'], error: 'out of memory' }),
      'Reranker batch failed; its chunks are unknown',
    );
  });

  it('logs each chunk the model had to cut', async () => {
    const { load } = fakeModel({ a: 0, b: 0, c: 0 }, ['c']);
    const logger = createCapturingLogger();
    const reranker = createBgeReranker(CONFIG, logger, load);

    await reranker.rerank('x', CHUNKS, 8);

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { role: 'reranker', chunkId: 'c', maxTokens: BGE_RERANKER_MAX_TOKENS },
      'Pair cut to fit the reranker',
    );
  });

  it('runs one rerank at a time', async () => {
    let running = 0;
    let most = 0;
    const load = vi.fn(async () => async (pairs: readonly { passage: string }[]) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return pairs.map(() => ({ logit: 0, truncated: false }));
    });
    const reranker = createBgeReranker(CONFIG, createCapturingLogger(), load);

    await Promise.all([reranker.rerank('x', CHUNKS, 8), reranker.rerank('y', CHUNKS, 8)]);

    expect(most).toBe(1);
  });
});

describe('loadBgeRerankerConfig', () => {
  it('defaults to int8, batches of 8 and threshold 0', () => {
    expect(loadBgeRerankerConfig({})).toMatchObject({ dtype: 'int8', batchSize: 8, threshold: 0 });
  });

  it.each([
    [{ RERANKER_DTYPE: 'fp16' }, 'Invalid RERANKER_DTYPE "fp16"'],
    [{ RERANK_THRESHOLD_BGE: '1.5' }, 'Invalid RERANK_THRESHOLD_BGE "1.5"'],
  ])('rejects %o', (env, message) => {
    expect(() => loadBgeRerankerConfig(env)).toThrow(message);
  });
});
