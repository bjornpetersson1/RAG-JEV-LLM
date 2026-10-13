import { describe, expect, it } from 'vitest';
import { describeRerank } from './FlowProgress';

describe('describeRerank', () => {
  const step = { step: 'rerank' as const, candidates: 30, unknown: 0, timings: {} };

  it.each([
    [{ judged: true, relevant: 5, approved: 5 }, '5 bedömda som relevanta av 30'],
    [{ judged: true, relevant: 0, approved: 0 }, '0 bedömda som relevanta av 30'],
    [
      { judged: true, relevant: 12, approved: 8 },
      '12 bedömda som relevanta av 30, de 8 bästa går vidare',
    ],
    [{ judged: false, relevant: 30, approved: 8 }, '8 högst rankade av 30'],
    [
      { judged: true, relevant: 0, unknown: 30, approved: 0 },
      '0 bedömda som relevanta av 30 (30 kunde inte bedömas)',
    ],
  ])('says what the step did for %o', (counts, text) => {
    expect(describeRerank({ ...step, ...counts })).toBe(text);
  });
});
