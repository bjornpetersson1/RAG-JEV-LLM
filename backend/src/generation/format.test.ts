import { describe, expect, it } from 'vitest';
import { NO_USAGE } from '../llm/client.js';
import type { GenerationResult } from './generate.js';
import { formatQueryResult } from './format.js';
import type { QueryRequest, QueryResult } from './query-flow.js';

const REQUEST: QueryRequest = { instruction: "Säljare's avtal", template: 'employment' };

const DRAFT: GenerationResult = {
  text: '# Anställningsavtal\n\nText [K:11].',
  used: [{ id: '11', text: 'a', source: 'SFS 1982:80 7 §' }],
  unused: [{ id: '12', text: 'b', source: 'SFS 1982:80 11 §' }],
  leftOut: [],
  check: { flags: [], matches: [], references: 1, valid: 1, sourceAccuracy: 1 },
  context: {
    limits: { maxChunks: 20, maxContextChars: 60_000 },
    limitedBy: [],
    needed: { maxChunks: 2, maxContextChars: 2 },
  },
  elapsedMs: 900,
  usage: { ...NO_USAGE, inputTokens: 5000, outputTokens: 1200 },
};

function result(draft?: GenerationResult, relevant = draft ? 2 : 0): QueryResult {
  return {
    flow: 'main',
    tags: ['anstallningsavtal', 'provanstallning'],
    candidates: 30,
    fallback: 0,
    approved: draft ? [...draft.used, ...draft.unused] : [],
    sources: [],
    judging: { relevant, cacheHits: 4, judgeCalls: 26, unknown: 0 },
    draft,
    timings: {
      translationMs: 800,
      searchMs: 15,
      judgingMs: 3000,
      sourcesMs: 3015,
      generationMs: draft?.elapsedMs,
      totalMs: 4715,
    },
    usage: {
      translation: {
        ...NO_USAGE,
        inputTokens: 2,
        cacheReadTokens: 880,
        cacheWriteTokens: 18,
        outputTokens: 40,
      },
      judging: NO_USAGE,
      generation: draft?.usage,
    },
  };
}

describe('formatQueryResult', () => {
  it('says how many relevant chunks RERANK_TOP_K left out', () => {
    expect(formatQueryResult(REQUEST, result(DRAFT, 15))).toContain(
      'approved: 2 (the best of 15 relevant; raise RERANK_TOP_K to keep more)',
    );
  });

  it('prints tags, counts, the draft, its sources and the time and tokens per step', () => {
    expect(formatQueryResult(REQUEST, result(DRAFT))).toBe(
      [
        'Tags: anstallningsavtal, provanstallning',
        'Candidates: 30 · approved: 2 · unknown: 0 · judge calls: 26 · cache hits: 4',
        'Submitted to the generator: 2',
        '',
        '# Anställningsavtal\n\nText [K:11].',
        '',
        'Sources used (1):',
        '  [K:11] SFS 1982:80 7 §',
        'Unused sources (1):',
        '  [K:12] SFS 1982:80 11 §',
        'Source accuracy: 100 % (1 of 1 references)',
        'Flagged references (0):',
        '',
        'Time (ms): translation 800 · search 15 · judging 3000 · sources 3015 · generation 900 · total 4715',
        'Tokens: translation in 2 + cache 898 / out 40 · judging in 0 / out 0 · generation in 5000 / out 1200',
      ].join('\n'),
    );
  });

  it('prints the source accuracy and each flagged reference with its position', () => {
    const check = {
      matches: [],
      flags: [
        {
          kind: 'citation' as const,
          text: '[K:99]',
          start: 40,
          end: 46,
          reason: 'chunk 99 was not submitted',
        },
        {
          kind: 'free-text' as const,
          text: '8 § LAS',
          start: 60,
          end: 67,
          reason: 'no submitted chunk is from SFS 1982:80 8 §',
        },
      ],
      references: 3,
      valid: 1,
      sourceAccuracy: 1 / 3,
    };

    expect(formatQueryResult(REQUEST, result({ ...DRAFT, check }))).toContain(
      [
        'Source accuracy: 33 % (1 of 3 references)',
        'Flagged references (2):',
        '  40–46 citation "[K:99]": chunk 99 was not submitted',
        '  60–67 free-text "8 § LAS": no submitted chunk is from SFS 1982:80 8 §',
      ].join('\n'),
    );
  });

  it('computes the percentage from the counts, so 29 of 100 is 29 %, not 28 %', () => {
    const check = { flags: [], matches: [], references: 100, valid: 29, sourceAccuracy: 0.29 };

    expect(formatQueryResult(REQUEST, result({ ...DRAFT, check }))).toContain(
      'Source accuracy: 29 % (29 of 100 references)',
    );
  });

  it('rounds the source accuracy down, so a flagged draft never shows 100 %', () => {
    const check = {
      flags: [],
      matches: [],
      references: 250,
      valid: 249,
      sourceAccuracy: 249 / 250,
    };

    expect(formatQueryResult(REQUEST, result({ ...DRAFT, check }))).toContain(
      'Source accuracy: 99 % (249 of 250 references)',
    );
  });

  it('shows a draft without references as having no source accuracy', () => {
    const check = { flags: [], matches: [], references: 0, valid: 0, sourceAccuracy: null };

    expect(formatQueryResult(REQUEST, result({ ...DRAFT, check }))).toContain(
      'Source accuracy: – (no references)',
    );
  });

  it('says when the context limit left chunks out, with a command that includes them all', () => {
    const limited: GenerationResult = {
      ...DRAFT,
      leftOut: [{ id: '13', text: 'c' }],
      context: {
        limits: { maxChunks: 2, maxContextChars: 60_000 },
        limitedBy: ['maxChunks'],
        needed: { maxChunks: 3, maxContextChars: 61_234 },
      },
    };

    expect(formatQueryResult(REQUEST, result(limited))).toContain(
      [
        'Context limit reached: 1 approved chunk was left out (--max-chunks 2).',
        'To include every approved chunk, run again with a larger context:',
        "  npm run query -- 'Säljare'\\''s avtal' --template employment --max-chunks 3 --max-context-chars 61234",
      ].join('\n'),
    );
  });

  it('says when no approved chunk fit the limits, with the rerun command', () => {
    const nothingFit: GenerationResult = {
      ...DRAFT,
      text: undefined,
      used: [],
      unused: [],
      leftOut: [{ id: '13', text: 'c' }],
      context: {
        limits: { maxChunks: 20, maxContextChars: 10 },
        limitedBy: ['maxContextChars'],
        needed: { maxChunks: 1, maxContextChars: 400 },
      },
    };

    const output = formatQueryResult(REQUEST, result(nothingFit));

    expect(output).toContain(
      [
        'No approved chunk fit the context limits, so no draft was generated.',
        '',
        'Context limit reached: 1 approved chunk was left out (--max-context-chars 10).',
      ].join('\n'),
    );
    expect(output).not.toContain('Sources used');
  });

  it('says that no draft was written when nothing was approved', () => {
    const output = formatQueryResult(REQUEST, result());

    expect(output).toContain('No relevant sources were found, so no draft was generated.');
    expect(output).toContain(
      'Time (ms): translation 800 · search 15 · judging 3000 · sources 3015 · total 4715',
    );
    expect(output).not.toContain('generation');
  });

  it('prints the reference RAG without tags, with its judging and its own steps', () => {
    const reference: QueryResult = {
      ...result(DRAFT),
      flow: 'reference',
      tags: [],
      candidates: 30,
      judging: { relevant: 3, cacheHits: 0, judgeCalls: 30, unknown: 0 },
      timings: {
        searchMs: 410,
        judgingMs: 2000,
        sourcesMs: 2410,
        generationMs: 900,
        totalMs: 3310,
      },
      usage: { generation: DRAFT.usage },
    };

    const output = formatQueryResult(REQUEST, reference);

    expect(output).toContain(
      'Reference RAG: the 30 chunks BM25 ranks best for the instruction (no tags)',
    );
    expect(output).not.toContain('Tags:');
    expect(output).toContain('judge calls: 30');
    expect(output).toContain(
      'Time (ms): search 410 · judging 2000 · sources 2410 · generation 900 · total 3310',
    );
  });

  it('adds --reference to the rerun command of a reference run', () => {
    const limited: GenerationResult = {
      ...DRAFT,
      leftOut: [{ id: '13', text: 'c', source: 'SFS 1982:80 12 §' }],
      context: { ...DRAFT.context, limitedBy: ['maxChunks'] },
    };

    expect(formatQueryResult(REQUEST, { ...result(limited), flow: 'reference' })).toContain(
      '--max-chunks 2 --max-context-chars 2 --reference',
    );
  });
});
