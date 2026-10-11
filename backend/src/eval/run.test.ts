import { describe, expect, it } from 'vitest';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import type { ResolvedQuery } from './queries.js';
import { formatAsMarkdown, formatForTerminal } from './report.js';
import { runEvaluation, type EvalDependencies, type JudgeMode } from './run.js';

const QUERIES: ResolvedQuery[] = [
  {
    id: 'anst-01',
    kind: 'employment',
    template: 'employment',
    instruction: 'Konkurrensklausul',
    relevant: [],
    relevantIds: new Set(['1', '2']),
  },
  {
    id: 'nda-01',
    kind: 'nda',
    instruction: 'Sekretess',
    relevant: [],
    relevantIds: new Set(['5']),
  },
];

/** Candidates per query instruction and search mode. */
const CANDIDATES: Record<string, Record<'tags' | 'fts', string[]>> = {
  Konkurrensklausul: { tags: ['1', '2', '3', '4'], fts: ['2', '9'] },
  Sekretess: { tags: ['5'], fts: [] },
};

/** Scores per chunk id the fake judge gives; chunk 4 is unknown. */
const SCORES: Record<string, number> = { '1': 0.9, '2': 0.4, '3': 0.6, '5': 0.8 };

function fakeDeps(jevAnsweredBy: 'jev' | 'llm' = 'llm') {
  const judgeCalls: { mode: JudgeMode; ids: string[] }[] = [];
  const deps: EvalDependencies = {
    translate: async (query) => [query.instruction.toLowerCase()],
    search: (query, _tags, mode) => CANDIDATES[query.instruction][mode],
    loadChunks: (ids) => ids.map((id) => ({ id, text: `Text ${id}` })),
    judge: async (mode, _instruction, chunks) => {
      judgeCalls.push({ mode, ids: chunks.map((chunk) => chunk.id) });
      return fakeRerankResult(chunks, SCORES, {
        answeredBy: mode === 'tags+jev' ? jevAnsweredBy : 'llm',
        stats: { calls: chunks.length, elapsedMs: 1 },
      });
    },
    judges: {
      'tags+jev': {
        name: jevAnsweredBy,
        model: jevAnsweredBy === 'jev' ? 'jev-latest' : 'claude-haiku-5-5',
      },
      'tags+llm': { name: 'llm', model: 'claude-haiku-5-5' },
    },
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
      'tags+llm': ['1', '3'],
      fts: ['2', '9'],
    });
    expect(anst.relevance).toEqual({
      tags: { precision: 0.5, recall: 1 },
      'tags+jev': { precision: 0.5, recall: 0.5 },
      'tags+llm': { precision: 0.5, recall: 0.5 },
      fts: { precision: 0.5, recall: 0.5 },
    });
    expect(nda.relevance.fts).toEqual({ precision: 0, recall: 0 });
    expect(result.modes.tags).toEqual({ precision: 0.75, recall: 1, f1: 1.5 / 1.75 });
    expect(anst.unknown).toEqual({ 'tags+jev': 1, 'tags+llm': 1 });
    // Without a JEV key both modes have the same judge, which judges the tag candidates once.
    expect(judgeCalls).toEqual([
      { mode: 'tags+jev', ids: ['1', '2', '3', '4'] },
      { mode: 'tags+jev', ids: ['5'] },
    ]);
  });

  it('asks each judge when the two modes have different judges', async () => {
    const { deps, judgeCalls } = fakeDeps('jev');

    await runEvaluation(QUERIES, deps);

    expect(judgeCalls.map((call) => call.mode)).toEqual([
      'tags+jev',
      'tags+llm',
      'tags+jev',
      'tags+llm',
    ]);
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
    expect(result.modes.tags).toMatchObject({ precision: 1, recall: 1 });
    expect(formatForTerminal(result)).toContain(
      '1 query failed (left out of every average):\n  - anst-01: claude exited with code 1',
    );
    expect(formatAsMarkdown(result, { startedAt: new Date(), settings: {} })).toContain(
      '- anst-01: claude exited with code 1',
    );
  });

  it('sweeps thresholds over the judged scores and recommends the best F1', async () => {
    const { deps } = fakeDeps();

    const result = await runEvaluation(QUERIES, deps);

    // Up to 0.4 every relevant chunk is returned (F1 0.909); at 0.7 chunk 2 is lost (F1 0.857).
    const sweep = result.sweeps['tags+llm'];
    expect(sweep.find((row) => row.threshold === 0.4)).toMatchObject({
      precision: expect.closeTo(5 / 6),
      recall: 1,
    });
    expect(sweep.find((row) => row.threshold === 0.7)).toMatchObject({
      precision: 1,
      recall: 0.75,
    });
    expect(result.recommended['tags+llm']).toMatchObject({ threshold: 0.1, recall: 1 });
  });

  it('reports which judge answered and how many judgements each gave', async () => {
    const withoutKey = await runEvaluation(QUERIES, fakeDeps('llm').deps);
    const withKey = await runEvaluation(QUERIES, fakeDeps('jev').deps);

    expect(withoutKey.answeredBy['tags+jev']).toEqual({ jev: 0, llm: 4 });
    expect(withKey.answeredBy['tags+jev']).toEqual({ jev: 4, llm: 0 });
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
    expect(text).toMatch(/ {2}tags {7}0\.750 {6}1\.000 {6}0\.857/);
    expect(text).toContain('Threshold sweep for tags+llm');
    expect(text).toMatch(/0\.1 .*<- recommended/);
    expect(text).toContain('Recommended threshold: 0.1 (highest F1)');
  });

  it('writes Markdown with the settings, summary, sweeps and one row per query', async () => {
    const result = await runEvaluation(QUERIES, fakeDeps().deps);

    const markdown = formatAsMarkdown(result, {
      startedAt: new Date('2026-10-11T12:00:00Z'),
      settings: { 'LLM judge': 'claude-code claude-haiku-5-5' },
    });

    expect(markdown).toContain('Run started 2026-10-11T12:00:00.000Z over 2 queries');
    expect(markdown).toContain('- LLM judge: `claude-code claude-haiku-5-5`');
    expect(markdown).toContain('| tags | 0.750 | 1.000 | 0.857 |');
    expect(markdown).toContain('## Threshold sweep: tags+jev');
    expect(markdown).toContain(
      '| anst-01 | employment | employment | 1 | 2 | 0.500 / 1.000 (4) | 0.500 / 0.500 (2) | 0.500 / 0.500 (2) | 0.500 / 0.500 (2) |',
    );
    expect(markdown).toContain('| nda-01 | nda | – | 1 | 1 |');
  });
});
