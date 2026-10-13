import { describe, expect, it } from 'vitest';
import type { CandidateSweepRow } from './sweep.js';
import { sweepRows } from './sweep-report.js';

function row(candidates: number, topK: number): CandidateSweepRow {
  return {
    retriever: 'tags',
    candidates,
    topK,
    scores: {
      central: { precision: 0.5, recall: 0.4, f1: 0.444 },
      all: { precision: 0.75, recall: 0.3, f1: 0.429 },
    },
    rerankMs: { median: 2700, p90: 3100 },
    queries: 20,
  };
}

describe('sweepRows', () => {
  it('gives one row per setting, marking the baseline and the chosen one', () => {
    const baseline = row(30, 8);
    const chosen = row(20, 5);

    expect(
      sweepRows([baseline, chosen], [{ retriever: 'tags', baseline, chosen }], 'minilm', 'd'),
    ).toEqual([
      '| d | tags | minilm | 30 | 8 | 0.500 | 0.400 | 0.444 | 0.750 | 0.300 | 0.429 | 2700 / 3100 | 20 | baseline |',
      '| d | tags | minilm | 20 | 5 | 0.500 | 0.400 | 0.444 | 0.750 | 0.300 | 0.429 | 2700 / 3100 | 20 | chosen |',
    ]);
  });
});
