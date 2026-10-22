import { describe, expect, it } from 'vitest';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import type { ResolvedQuery } from './queries.js';
import { formatAsMarkdown, formatForTerminal } from './report.js';
import {
  byJudgeMode,
  runEvaluation,
  type DocumentType,
  type EvalDependencies,
  type JudgeMode,
} from './run.js';

const QUERIES: ResolvedQuery[] = [
  {
    id: 'anst-01',
    kind: 'employment',
    template: 'employment',
    instruction: 'Konkurrensklausul',
    relevant: [],
    relevantIds: new Set(['1', '2']),
    // Chunk 2 is related, not central.
    centralIds: new Set(['1']),
  },
  {
    id: 'nda-01',
    kind: 'nda',
    instruction: 'Sekretess',
    relevant: [],
    relevantIds: new Set(['5']),
    centralIds: new Set(['5']),
  },
];

/** Candidates per query instruction and search mode. */
const CANDIDATES: Record<string, Record<'tags' | 'fts', string[]>> = {
  Konkurrensklausul: { tags: ['1', '2', '3', '4'], fts: ['2', '9'] },
  Sekretess: { tags: ['5'], fts: [] },
};

/** Scores per chunk id the fake judge gives; chunk 4 is unknown. */
const SCORES: Record<string, number> = { '1': 0.9, '2': 0.4, '3': 0.6, '5': 0.8 };

/** Chunks 1, 2 and 9 are from laws, 3, 4 and 5 from rulings. */
const DOCUMENT_TYPES = new Map<string, DocumentType>([
  ['1', 'law'],
  ['2', 'law'],
  ['9', 'law'],
  ['3', 'ruling'],
  ['4', 'ruling'],
  ['5', 'ruling'],
]);

function fakeDeps(jevAnsweredBy: 'jev' | 'llm' = 'llm', subqAnsweredBy: 'subq' | 'llm' = 'llm') {
  const judgeCalls: { mode: JudgeMode; ids: string[] }[] = [];
  const answeredBy: Record<JudgeMode, 'jev' | 'subq' | 'llm'> = {
    'tags+jev': jevAnsweredBy,
    'tags+subq': subqAnsweredBy,
    'tags+llm': 'llm',
  };
  const models = { jev: 'jev-latest', subq: 'subq-snap-preview', llm: 'claude-haiku-5-5' };
  const deps: EvalDependencies = {
    translate: async (query) => [query.instruction.toLowerCase()],
    search: (query, _tags, mode) => CANDIDATES[query.instruction][mode],
    loadChunks: (ids) => ids.map((id) => ({ id, text: `Text ${id}` })),
    documentTypes: () => DOCUMENT_TYPES,
    judge: async (mode, _instruction, chunks) => {
      judgeCalls.push({ mode, ids: chunks.map((chunk) => chunk.id) });
      return fakeRerankResult(chunks, SCORES, {
        answeredBy: answeredBy[mode],
        stats: { calls: chunks.length, elapsedMs: 1 },
      });
    },
    judges: byJudgeMode((mode) => ({
      name: answeredBy[mode],
      model: models[answeredBy[mode]],
    })),
    topK: 8,
  };
  return { deps, judgeCalls };
}

describe('runEvaluation', () => {
  it('scores each mode per query and as macro averages', async () => {
    const { deps, judgeCalls } = fakeDeps();

    const result = await runEvaluation(QUERIES, deps);

    const [anst, nda] = result.queries;
    expect(anst.returned).toEqual({
      tags: ['1', '2', '3', '4'],
      'tags+jev': ['1', '3'],
      'tags+subq': ['1', '3'],
      'tags+llm': ['1', '3'],
      fts: ['2', '9'],
    });
    expect(anst.relevance.tags).toEqual({
      all: { precision: 0.5, recall: 1, precision5: 0.4, precision10: 0.2 },
      central: { precision: 0.25, recall: 1, precision5: 0.2, precision10: 0.1 },
    });
    expect(anst.relevance['tags+jev']).toEqual({
      all: { precision: 0.5, recall: 0.5, precision5: 0.2, precision10: 0.1 },
      central: { precision: 0.5, recall: 1, precision5: 0.2, precision10: 0.1 },
    });
    expect(anst.relevance.fts.central).toEqual({
      precision: 0,
      recall: 0,
      precision5: 0,
      precision10: 0,
    });
    expect(nda.relevance.fts.all).toMatchObject({ precision: 0, recall: 0 });
    expect(result.modes.tags.all).toEqual({
      precision: 0.75,
      recall: 1,
      f1: 1.5 / 1.75,
      precision5: expect.closeTo(0.3, 10),
      precision10: expect.closeTo(0.15, 10),
    });
    expect(anst.unknown).toEqual({ 'tags+jev': 1, 'tags+subq': 1, 'tags+llm': 1 });
    // Without JEV and SubQ keys every mode has the same judge, which judges the candidates once.
    expect(judgeCalls).toEqual([
      { mode: 'tags+jev', ids: ['1', '2', '3', '4'] },
      { mode: 'tags+jev', ids: ['5'] },
    ]);
  });

  it('asks each judge when the two modes have different judges', async () => {
    const { deps, judgeCalls } = fakeDeps('jev');

    const result = await runEvaluation(QUERIES, deps);

    // Without a SubQ key the LLM judges tags+subq and tags+llm, asked once under the first of them.
    expect(judgeCalls.map((call) => call.mode)).toEqual([
      'tags+jev',
      'tags+subq',
      'tags+jev',
      'tags+subq',
    ]);
    expect(result.answeredBy['tags+llm']).toEqual({ jev: 0, subq: 0, llm: 4 });
  });

  it('asks SubQ for tags+subq once it has a key, and counts its judgements', async () => {
    const { deps, judgeCalls } = fakeDeps('llm', 'subq');

    const result = await runEvaluation(QUERIES, deps);

    expect(judgeCalls.map((call) => call.mode)).toEqual([
      'tags+jev',
      'tags+subq',
      'tags+jev',
      'tags+subq',
    ]);
    expect(result.answeredBy['tags+subq']).toEqual({ jev: 0, subq: 4, llm: 0 });
    expect(formatForTerminal(result)).toContain('answered by SubQ 4');
  });

  it('reports statutes and rulings apart, over the queries with relevant chunks of each', async () => {
    const result = await runEvaluation(QUERIES, fakeDeps().deps);

    const [anst, nda] = result.queries;
    // anst-01: relevant 1 and 2 are laws; the tag candidates hold laws 1, 2 and rulings 3, 4.
    expect(anst.relevanceByType.tags.law.all).toMatchObject({ precision: 1, recall: 1 });
    expect(anst.relevanceByType.tags.ruling.all).toBeUndefined();
    expect(anst.relevanceByType['tags+llm'].law.central).toMatchObject({
      precision: 1,
      recall: 1,
    });
    expect(nda.relevanceByType.tags.ruling.all).toMatchObject({ precision: 1, recall: 1 });
    expect(nda.relevanceByType.tags.law.all).toBeUndefined();
    expect(result.modesByType.tags.law.all).toMatchObject({ precision: 1, recall: 1, queries: 1 });
    expect(result.modesByType.fts.law.all).toMatchObject({
      precision: 0.5,
      recall: 0.5,
      queries: 1,
    });
    expect(result.modesByType.tags.ruling.central.queries).toBe(1);
    // P@K counts the type's relevant chunks among the whole list's top K: fts has law 2 first.
    expect(anst.relevanceByType.fts.law.all).toMatchObject({ precision5: 0.2 });
    // tags+llm returns 1 (law) then 3 (ruling): ruling recall is undefined for anst-01, law P@5 is 1/5.
    expect(anst.relevanceByType['tags+llm'].law.all).toMatchObject({ precision5: 0.2 });
    const markdown = formatAsMarkdown(result, { startedAt: new Date(), settings: {} });
    expect(markdown).toContain('## Relevance per document type');
    expect(markdown).toContain('| tags | law | all | 1 | 1.000 | 1.000 |');
  });

  it('counts the queries a judge approved nothing for and spreads its scores over ten bands', async () => {
    const deps: EvalDependencies = {
      ...fakeDeps().deps,
      judge: async (_mode, _instruction, chunks) =>
        fakeRerankResult(chunks, { '1': 0.95, '2': 0.05, '3': 0.55, '4': 1, '5': 0.05 }),
    };

    const result = await runEvaluation(QUERIES, deps);

    expect(result.noneApproved).toEqual({ 'tags+jev': 1, 'tags+subq': 1, 'tags+llm': 1 });
    // A query whose candidates were all unknown has no verdict, so it is not counted.
    const unknown = await runEvaluation(QUERIES, {
      ...deps,
      judge: async (_mode, _instruction, chunks) => fakeRerankResult(chunks, {}),
    });
    expect(unknown.noneApproved).toEqual({ 'tags+jev': 0, 'tags+subq': 0, 'tags+llm': 0 });
    expect(result.scoreDistribution['tags+subq']).toEqual([0.4, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.4]);
    const markdown = formatAsMarkdown(result, { startedAt: new Date(), settings: {} });
    expect(markdown).toContain('| tags+subq | 1 | 0.40 | 0.00 |');
  });

  it('leaves a failing query out of the averages, reports it and goes on', async () => {
    const { deps } = fakeDeps();
    const failures: string[] = [];
    const failing: EvalDependencies = {
      ...deps,
      translate: async (query) => {
        if (query.instruction === 'Konkurrensklausul') throw new Error('claude exited with code 1');
        return deps.translate(query);
      },
      onFailure: (failure) => failures.push(failure.id),
    };

    const result = await runEvaluation(QUERIES, failing);

    expect(result.queries.map((outcome) => outcome.query.id)).toEqual(['nda-01']);
    expect(result.failed).toEqual([{ id: 'anst-01', error: 'claude exited with code 1' }]);
    expect(failures).toEqual(['anst-01']);
    expect(result.modes.tags.all).toMatchObject({ precision: 1, recall: 1 });
    expect(formatForTerminal(result)).toContain(
      '1 query failed (left out of every average):\n  - anst-01: claude exited with code 1',
    );
    expect(formatAsMarkdown(result, { startedAt: new Date(), settings: {} })).toContain(
      '- anst-01: claude exited with code 1',
    );
  });

  it('sweeps thresholds over the judged scores per grade and recommends the best central F1', async () => {
    const { deps } = fakeDeps();

    const result = await runEvaluation(QUERIES, deps);

    // Up to 0.4 every relevant chunk is returned (F1 0.909); at 0.7 chunk 2 is lost (F1 0.857).
    const sweep = result.sweeps['tags+llm'].all;
    expect(sweep.find((row) => row.threshold === 0.4)).toMatchObject({
      precision: expect.closeTo(5 / 6),
      recall: 1,
    });
    expect(sweep.find((row) => row.threshold === 0.7)).toMatchObject({
      precision: 1,
      recall: 0.75,
    });
    // Against the central chunks (1 and 5), chunk 3 (0.6) costs precision until 0.7; 0.8 still keeps 5.
    expect(result.sweeps['tags+llm'].central.find((row) => row.threshold === 0.7)).toMatchObject({
      precision: 1,
      recall: 1,
    });
    expect(result.recommended['tags+llm']).toMatchObject({ threshold: 0.7, f1: 1 });
  });

  it('reports which judge answered and how many judgements each gave', async () => {
    const withoutKey = await runEvaluation(QUERIES, fakeDeps('llm').deps);
    const withKey = await runEvaluation(QUERIES, fakeDeps('jev').deps);

    expect(withoutKey.answeredBy['tags+jev']).toEqual({ jev: 0, subq: 0, llm: 4 });
    expect(withKey.answeredBy['tags+jev']).toEqual({ jev: 4, subq: 0, llm: 0 });
    expect(formatForTerminal(withoutKey)).toContain(
      'no JEV_API_KEY, so the LLM answered all 4 judgements instead of JEV',
    );
    expect(formatForTerminal(withKey)).toContain('answered by JEV 4, by the LLM 0');
  });
});

describe('report', () => {
  it('prints the relevance table, sweeps and recommendations', async () => {
    const result = await runEvaluation(QUERIES, fakeDeps().deps);

    const text = formatForTerminal(result);

    expect(text).toContain('Relevance over 2 queries (macro average):');
    expect(text).toMatch(/ {2}tags {7}all {6}0\.750 {6}1\.000 {6}0\.857 {6}0\.300 {6}0\.150/);
    expect(text).toMatch(/ {2}tags {7}central {2}0\.625 /);
    expect(text).toContain('Threshold sweep for tags+llm');
    expect(text).toMatch(/0\.7 {8}1\.000 {6}1\.000 {6}1\.000 {6}1\.000 .*<- recommended/);
    expect(text).toContain('Recommended threshold: 0.7 (highest central F1)');
  });

  it('writes Markdown with the settings, summary, sweeps and one row per query', async () => {
    const result = await runEvaluation(QUERIES, fakeDeps().deps);

    const markdown = formatAsMarkdown(result, {
      startedAt: new Date('2026-10-11T12:00:00Z'),
      settings: { 'LLM judge': 'claude-code claude-haiku-5-5' },
    });

    expect(markdown).toContain('Run started 2026-10-11T12:00:00.000Z over 2 queries');
    expect(markdown).toContain('- LLM judge: `claude-code claude-haiku-5-5`');
    expect(markdown).toContain('| tags | all | 0.750 | 1.000 | 0.857 | 0.300 | 0.150 |');
    expect(markdown).toContain('| tags | central | 0.625 | 1.000 |');
    expect(markdown).toContain('## Threshold sweep: tags+jev');
    expect(markdown).toContain(
      '| anst-01 | employment | employment | 1 | 2 | 0.500 / 1.000 (4) | 0.500 / 0.500 (2) | 0.500 / 0.500 (2) | 0.500 / 0.500 (2) | 0.500 / 0.500 (2) |',
    );
    expect(markdown).toContain('| nda-01 | nda | – | 1 | 1 |');
  });
});
