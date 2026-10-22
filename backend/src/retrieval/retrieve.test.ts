import { describe, expect, it, vi } from 'vitest';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import { formatRetrieveResult, parseRetrieveArgs, retrieve } from './retrieve.js';
import type { Retriever } from './retriever.js';

const CHUNKS = {
  '11': { id: '11', text: 'Uppsägning ska vara sakligt grundad.', source: 'SFS 1982:80 7 §' },
  '21': { id: '21', text: 'Konkurrensklausulen är oskälig.', source: 'AD 2015 nr 8' },
};

function fakeRetriever(): Retriever {
  return {
    name: 'tags',
    retrieve: vi.fn(async () => ({
      candidates: [
        { chunkId: 21, origin: 'tag' as const },
        { chunkId: 11, origin: 'fts' as const },
      ],
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
    const result = await retrieve('7 § LAS', 1, {
      retriever: fakeRetriever(),
      translate: async () => ['uppsagning'],
      loadChunks: (ids) => ids.map((id) => CHUNKS[id as keyof typeof CHUNKS]),
      reranker,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      chunk: { id: '11' },
      score: 0.9,
      retrievalRank: 2,
      origin: 'fts',
    });
    expect(result.timings).toMatchObject({ retrievalMs: 2, rerankMs: 7 });
  });

  it('searches with the tags of the translated question', async () => {
    const translate = vi.fn(async () => ['uppsagning']);
    const retriever = fakeRetriever();

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
      retriever: 'tags',
      reranker: 'llm (claude-haiku-5-5)',
      candidates: 40,
      chunks: [
        {
          chunk: CHUNKS['11'],
          score: 0.9123,
          reranker: 'llm',
          model: 'm',
          retrievalRank: 3,
          origin: 'fts',
        },
      ],
      timings: { translationMs: 900, retrievalMs: 15, rerankMs: 30000, totalMs: 31000 },
    });

    expect(text).toBe(
      [
        'Retriever: tags (40 candidates) · reranker: llm (claude-haiku-5-5)',
        '',
        ' 1. SFS 1982:80 7 § · rerank 0.912 · retrieval rank 3 (fts)',
        '',
        'Time (ms): translation 900 · retrieval 15 · rerank 30000 · total 31000',
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
