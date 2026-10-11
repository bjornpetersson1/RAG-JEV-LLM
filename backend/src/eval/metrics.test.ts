import { describe, expect, it } from 'vitest';
import {
  averageOver,
  precisionRecall,
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

  it('recommends the lowest threshold among those with the highest F1', () => {
    const row = (threshold: number, f1: number) => ({ threshold, precision: 0, recall: 0, f1 });

    expect(
      recommendThreshold([row(0.1, 0.4), row(0.2, 0.7), row(0.3, 0.7), row(0.4, 0.6)]),
    ).toEqual(row(0.2, 0.7));
  });
});
