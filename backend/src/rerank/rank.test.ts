import { describe, expect, it } from 'vitest';
import { bestFirst } from './rank.js';

const scored = (scores: Record<string, number>) =>
  Object.entries(scores).map(([id, score]) => ({
    chunk: { id, text: id },
    score,
    reranker: 'llm',
    model: 'm',
  }));

const ids = (list: { chunk: { id: string } }[]) => list.map(({ chunk }) => chunk.id);

describe('bestFirst', () => {
  it('orders by descending score, ties in input order', () => {
    expect(ids(bestFirst(scored({ '1': 0.7, '2': 0.9, '3': 0.7 })))).toEqual(['2', '1', '3']);
  });
});
