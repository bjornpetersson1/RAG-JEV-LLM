import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { tag } from '../query/test-helpers.js';
import {
  benchWork,
  callsSubq,
  compareWork,
  confirmSubqRun,
  evalWork,
  subqCalls,
  sweepWork,
  translationCalls,
} from './subq-estimate.js';

const SUBQ = { SUBQ_API_KEY: 'k' };

/** 20 tags in one area, so it takes two calls of at most 16 questions, and one in another. */
const VOCABULARY = [
  ...Array.from({ length: 20 }, (_, i) => tag(`lon-${i}`, 'lon')),
  tag('semesterlon', 'semester'),
];

describe('the SubQ work per command', () => {
  it('eval:run judges the tag candidates with SubQ only when it has a key', () => {
    expect(evalWork({})).toEqual({
      translationsPerQuery: 0,
      judgementsPerQuery: 0,
      extraJudgements: 0,
    });
    expect(evalWork({ ...SUBQ, MAX_CANDIDATES: '25' })).toEqual({
      translationsPerQuery: 0,
      judgementsPerQuery: 25,
      extraJudgements: 0,
    });
    expect(evalWork({ ...SUBQ, QUERY_TRANSLATOR_IMPL: 'subq' }).translationsPerQuery).toBe(1);
  });

  it('the comparison judges every retriever list with subq, then a cache-off latency pass', () => {
    expect(compareWork({ ...SUBQ }, ['subq', 'minilm'], ['tags', 'bge'], 5)).toEqual({
      translationsPerQuery: 0,
      // MAX_CANDIDATES 30 for tags, RETRIEVE_CANDIDATES 20 for bge.
      judgementsPerQuery: 50,
      extraJudgements: 250,
    });
    expect(
      compareWork({ ...SUBQ, QUERY_TRANSLATOR_IMPL: 'subq' }, ['minilm'], ['bge'], 5),
    ).toMatchObject({ translationsPerQuery: 0, judgementsPerQuery: 0 });
  });

  it('the sweep judges both swept retrievers at 50 candidates with RERANKER=subq', () => {
    expect(sweepWork({ ...SUBQ, RERANKER: 'subq' }).judgementsPerQuery).toBe(100);
    expect(callsSubq(sweepWork({ RERANKER: 'minilm' }))).toBe(false);
    // A blank RERANKER sweeps with minilm, whatever the default reranker is.
    expect(callsSubq(sweepWork({ ...SUBQ }))).toBe(false);
  });

  it('the comparison calls no SubQ without a key: it skips the subq reranker', () => {
    expect(callsSubq(compareWork({}, ['subq', 'llm'], ['tags'], 5))).toBe(false);
  });

  it('bench:compare judges and translates in the main flow per run; the reference RAG uses the LLM', () => {
    expect(benchWork({ ...SUBQ, RERANKER: 'subq', QUERY_TRANSLATOR_IMPL: 'subq' }, 2)).toEqual({
      translationsPerQuery: 2,
      // 30 tag candidates in the main flow, twice.
      judgementsPerQuery: 60,
      extraJudgements: 0,
    });
  });

  it('a configuration without SubQ calls it nowhere, even with a key', () => {
    const env = { ...SUBQ, RERANKER: 'minilm', QUERY_TRANSLATOR_IMPL: 'llm' };
    expect(callsSubq(compareWork(env, ['minilm', 'llm'], ['tags'], 5))).toBe(false);
    expect(callsSubq(sweepWork(env))).toBe(false);
    expect(callsSubq(benchWork(env, 5))).toBe(false);
  });
});

describe('subqCalls', () => {
  it('counts the judge calls and their characters for fixed queries', () => {
    const calls = subqCalls(
      { translationsPerQuery: 0, judgementsPerQuery: 2, extraJudgements: 0 },
      { instructions: ['Avtal'], vocabulary: VOCABULARY, maxJudgedChars: 100 },
    );

    // Two calls of 100 characters of chunk, the 47-character question and 200 of overhead.
    expect(calls).toEqual({ calls: 2, chars: 694 });
  });

  it('counts one Choice call and the tag calls of up to three areas per translation', () => {
    const calls = subqCalls(
      { translationsPerQuery: 1, judgementsPerQuery: 0, extraJudgements: 0 },
      { instructions: ['Lön', 'Semester'], vocabulary: VOCABULARY, maxJudgedChars: 100 },
    );

    // Per query: the Choice call, two calls for lon's 20 tags and one for semester's.
    expect(calls.calls).toBe(8);
  });

  it('counts the most calls and the most characters any three areas need, apart', () => {
    // Areas a, b and c need two calls each with short tags; d needs one call with very long tags.
    const shortTags = (area: string) =>
      Array.from({ length: 17 }, (_, i) => ({ ...tag(`${area}-${i}`, area), description: 'x' }));
    const longTags = Array.from({ length: 16 }, (_, i) => ({
      ...tag(`d-${i}`, 'd'),
      description: 'y'.repeat(500),
    }));
    const vocabulary = [...shortTags('a'), ...shortTags('b'), ...shortTags('c'), ...longTags];

    const calls = translationCalls(['Avtal'], vocabulary);

    // The Choice call and two calls in each of the three two-call areas.
    expect(calls.calls).toBe(7);
    // The long area's 8,000 characters of descriptions are among the three largest.
    expect(calls.chars).toBeGreaterThan(16 * 500);
  });
});

describe('confirmSubqRun', () => {
  const text = () => ({ instructions: ['Avtal'], vocabulary: VOCABULARY, maxJudgedChars: 100 });

  function pipe() {
    const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
    stream.isTTY = false;
    return stream;
  }

  it('goes on without a word when the run calls no SubQ', async () => {
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => (printed += chunk.toString()));

    await expect(
      confirmSubqRun(
        { translationsPerQuery: 0, judgementsPerQuery: 0, extraJudgements: 0 },
        () => {
          throw new Error('not needed');
        },
        { yes: false, input: pipe(), output },
      ),
    ).resolves.toBe(true);
    expect(printed).toBe('');
  });

  it('stops a SubQ run on a pipe without --yes, and lets it go on with --yes', async () => {
    const work = { translationsPerQuery: 0, judgementsPerQuery: 2, extraJudgements: 0 };
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => (printed += chunk.toString()));

    await expect(confirmSubqRun(work, text, { yes: false, input: pipe(), output })).resolves.toBe(
      false,
    );
    await expect(confirmSubqRun(work, text, { yes: true, input: pipe(), output })).resolves.toBe(
      true,
    );
    expect(printed).toContain('at most 2 SubQ calls, 347 input tokens');
  });
});
