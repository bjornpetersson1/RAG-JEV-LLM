import { describe, expect, it } from 'vitest';
import {
  averageOver,
  precisionAt,
  precisionRecall,
  recallAt,
  recommendThreshold,
  SWEEP_THRESHOLDS,
  sweepThresholds,
} from './metrics.js';

describe('precisionRecall', () => {
  it('counts the relevant chunks among those returned', () => {
    // 2 of the 4 returned are relevant; 2 of the 3 relevant are returned.
    expect(precisionRecall(['1', '2', '3', '4'], new Set(['2', '4', '9']))).toEqual({
      precision: 0.5,
      recall: 2 / 3,
    });
  });

  it('gives precision 0 when nothing is returned', () => {
    expect(precisionRecall([], new Set(['1']))).toEqual({ precision: 0, recall: 0 });
  });
});

describe('averageOver', () => {
  it('averages precision and recall over the queries and takes F1 of the averages', () => {
    const scores = averageOver([
      { precision: 1, recall: 0.5 },
      { precision: 0.5, recall: 0.5 },
    ]);

    expect(scores).toEqual({ precision: 0.75, recall: 0.5, f1: 0.6 });
    expect(averageOver([])).toEqual({ precision: 0, recall: 0, f1: 0 });
  });
});

describe('threshold sweep', () => {
  it('applies each threshold from 0.1 to 0.9 to the given scores', () => {
    expect(SWEEP_THRESHOLDS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    const rows = sweepThresholds([
      {
        scores: [
          { chunkId: 'a', score: 0.9 },
          { chunkId: 'b', score: 0.55 },
          { chunkId: 'c', score: 0.2 },
        ],
        relevant: new Set(['a', 'b']),
      },
    ]);

    expect(rows[0]).toMatchObject({ threshold: 0.1, precision: 2 / 3, recall: 1 });
    expect(rows[4]).toMatchObject({ threshold: 0.5, precision: 1, recall: 1, f1: 1 });
    expect(rows[8]).toMatchObject({ threshold: 0.9, precision: 1, recall: 0.5 });
    expect(recommendThreshold(rows).threshold).toBe(0.3);
  });

  it('keeps at most topK chunks per query, the best scored, as the query flow does', () => {
    const rows = sweepThresholds(
      [
        {
          scores: [
            { chunkId: 'c', score: 0.2 },
            { chunkId: 'a', score: 0.9 },
            { chunkId: 'b', score: 0.55 },
          ],
          relevant: new Set(['a']),
        },
      ],
      1,
    );

    // At 0.1 all three pass, but only the best (a) is kept.
    expect(rows[0]).toMatchObject({ threshold: 0.1, precision: 1, recall: 1 });
  });

  it('recommends the lowest threshold among those with the highest F1', () => {
    const row = (threshold: number, f1: number) => ({ threshold, precision: 0, recall: 0, f1 });

    expect(
      recommendThreshold([row(0.1, 0.4), row(0.2, 0.7), row(0.3, 0.7), row(0.4, 0.6)]),
    ).toEqual(row(0.2, 0.7));
  });
});

describe('precisionAt and recallAt', () => {
  const relevant = new Set(['a', 'b', 'c']);

  it('counts the relevant chunks among the first k', () => {
    expect(precisionAt(['a', 'x', 'b', 'y', 'c', 'd'], relevant, 5)).toBe(0.6);
    expect(recallAt(['a', 'x', 'b', 'y', 'c', 'd'], relevant, 2)).toBeCloseTo(1 / 3);
  });

  it('counts missing places as not relevant when fewer than k chunks are returned', () => {
    expect(precisionAt(['a', 'b'], relevant, 5)).toBe(0.4);
    expect(precisionAt([], relevant, 10)).toBe(0);
  });

  it('gives a recall of 0 when nothing is relevant', () => {
    expect(recallAt(['a'], new Set(), 5)).toBe(0);
  });
});
