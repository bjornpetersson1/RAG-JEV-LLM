import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import { checkRetrieverReady } from './setup.js';
import { formatRetrieveResult, parseRetrieveArgs, retrieve } from './retrieve.js';
import type { Retriever } from './retriever.js';

const CHUNKS = {
  '11': { id: '11', text: 'Uppsägning ska vara sakligt grundad.', source: 'SFS 1982:80 7 §' },
  '21': { id: '21', text: 'Konkurrensklausulen är oskälig.', source: 'AD 2015 nr 8' },
};

function fakeRetriever(usesTags: boolean): Retriever {
  return {
    name: usesTags ? 'both' : 'bge',
    usesTags,
    retrieve: vi.fn(async () => ({
      candidates: [
        { chunkId: 21, origin: 'dense' as const },
        { chunkId: 11, origin: 'lexical' as const },
      ],
      embedMs: 3,
      searchMs: 2,
    })),
  };
}

const reranker = {
  name: 'fake',
  model: 'fake-model',
  rerank: async (_query: string, chunks: readonly { id: string; text: string }[], topK: number) =>
    fakeRerankResult(chunks, { '11': 0.9, '21': 0.6 }, { topK, stats: { elapsedMs: 7 } }),
};

describe('retrieve', () => {
  it('retrieves, reranks and keeps the retrieval rank and origin of each kept chunk', async () => {
    const translate = vi.fn(async () => ['uppsagning']);

    const result = await retrieve('7 § LAS', 1, {
      retriever: fakeRetriever(false),
      translate,
      loadChunks: (ids) => ids.map((id) => CHUNKS[id as keyof typeof CHUNKS]),
      reranker,
    });

    expect(translate).not.toHaveBeenCalled();
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      chunk: { id: '11' },
      score: 0.9,
      retrievalRank: 2,
      origin: 'lexical',
    });
    expect(result.timings).toMatchObject({
      translationMs: 0,
      embedMs: 3,
      retrievalMs: 2,
      rerankMs: 7,
    });
  });

  it('translates the question when the retriever uses tags', async () => {
    const translate = vi.fn(async () => ['uppsagning']);
    const retriever = fakeRetriever(true);

    await retrieve('Uppsägning', 2, {
      retriever,
      translate,
      loadChunks: (ids) => ids.map((id) => CHUNKS[id as keyof typeof CHUNKS]),
      reranker,
    });

    expect(retriever.retrieve).toHaveBeenCalledWith('Uppsägning', ['uppsagning']);
  });

  it('prints source, rerank score and retrieval rank per chunk, and the time per step', () => {
    const text = formatRetrieveResult({
      retriever: 'bge',
      reranker: 'bge (onnx-community/bge-reranker-v2-m3-ONNX)',
      candidates: 40,
      chunks: [
        {
          chunk: CHUNKS['11'],
          score: 0.9123,
          reranker: 'bge',
          model: 'm',
          retrievalRank: 3,
          origin: 'lexical',
        },
      ],
      timings: { translationMs: 0, embedMs: 120, retrievalMs: 15, rerankMs: 30000, totalMs: 30140 },
    });

    expect(text).toBe(
      [
        'Retriever: bge (40 candidates) · reranker: bge (onnx-community/bge-reranker-v2-m3-ONNX)',
        '',
        ' 1. SFS 1982:80 7 § · rerank 0.912 · retrieval rank 3 (lexical)',
        '',
        'Time (ms): translation 0 · embed query 120 · retrieval 15 · rerank 30000 · total 30140',
      ].join('\n'),
    );
  });
});

describe('parseRetrieveArgs', () => {
  it.each([
    [['7 § LAS'], { question: '7 § LAS' }],
    [['7 § LAS', '--top-k', '3'], { question: '7 § LAS', topK: 3 }],
    [[], undefined],
    [['a', 'b'], undefined],
    [['x', '--top-k', '0'], undefined],
    [['x', '--other'], undefined],
  ])('parses %o', (args, expected) => {
    expect(parseRetrieveArgs(args)).toEqual(expected);
  });
});

describe('checkRetrieverReady', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('needs nothing for tag search', () => {
    expect(() => checkRetrieverReady('/no/such/database.db', {})).not.toThrow();
  });

  it('fails for bge, naming index:embed, when the chunks are not embedded', () => {
    database = createEvalDatabase();

    expect(() => checkRetrieverReady(database!.path, { RETRIEVER: 'bge' })).toThrow(
      'RETRIEVER=bge: 3 chunks have no up-to-date Xenova/bge-m3 (int8) embedding; run `npm run index:embed`',
    );
  });
});
