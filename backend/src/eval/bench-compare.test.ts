import { describe, expect, it } from 'vitest';
import type { QueryFlowName, QueryResult } from '../generation/query-flow.js';
import { NO_USAGE } from '../llm/client.js';
import type { Chunk } from '../llm/types.js';
import { benchCompare, type BenchFlow } from './bench-compare.js';
import type { ResolvedQuery } from './queries.js';

function query(id: string, relevant: string[]): ResolvedQuery {
  return {
    id,
    kind: 'employment',
    instruction: `Instruktion ${id}`,
    relevant: [],
    relevantIds: new Set(relevant),
    centralIds: new Set(relevant),
  };
}

const QUERIES = [query('q1', ['1', '2']), query('q2', ['3'])];

function chunk(id: string): Chunk {
  return { id, text: id };
}

interface FakeRun {
  ids: string[];
  totalMs: number;
  /** Valid of all references in the draft; absent: no draft. */
  references?: [valid: number, all: number];
  /** The ids that fit the context limits; default all of `ids`. */
  sent?: string[];
  /** Candidates the rerank could not score; default 0. */
  unknown?: number;
  /** A draft without text: no approved chunk fitted the context limits. */
  emptyDraft?: boolean;
}

/** A flow whose result for each query comes from `runs`, in call order per query. */
function fakeFlow(
  name: QueryFlowName,
  runs: Record<string, FakeRun[]>,
  calls: string[],
  remoteRerank = false,
): BenchFlow {
  const seen = new Map<string, number>();
  return {
    name,
    configuration: `${name} config`,
    remoteRerank,
    async run(q, { draft }) {
      calls.push(`${name}:${q.id}`);
      const index = seen.get(q.id) ?? 0;
      seen.set(q.id, index + 1);
      const fake = runs[q.id][index];
      if (!fake) throw new Error(`no run ${index} for ${q.id}`);
      const references = draft ? fake.references : undefined;
      const reranked = name === 'main';
      const result: QueryResult = {
        flow: name,
        tags: [],
        candidates: fake.ids.length,
        fallback: 0,
        approved: fake.ids.map(chunk),
        sources: fake.ids.map((id) => ({ chunk: chunk(id), status: 'sent', origin: 'lexical' })),
        ...(reranked && {
          judging: { relevant: 0, cacheHits: 0, judgeCalls: 0, unknown: fake.unknown ?? 0 },
        }),
        draft: references
          ? {
              text: fake.emptyDraft ? undefined : 'Utkast',
              used: (fake.sent ?? fake.ids).map(chunk),
              unused: [],
              leftOut: fake.ids.filter((id) => !(fake.sent ?? fake.ids).includes(id)).map(chunk),
              check: {
                flags: [],
                matches: [],
                valid: references[0],
                references: references[1],
                sourceAccuracy: null,
              },
              context: {
                limits: { maxChunks: 20, maxContextChars: 60_000 },
                limitedBy: [],
                needed: { maxChunks: 0, maxContextChars: 0 },
              },
              elapsedMs: 100,
              usage: NO_USAGE,
            }
          : undefined,
        timings: {
          translationMs: reranked ? 10 : undefined,
          searchMs: 20,
          judgingMs: reranked ? 30 : undefined,
          sourcesMs: reranked ? 50 : 20,
          generationMs: references ? 100 : undefined,
          totalMs: fake.totalMs,
        },
        usage: references ? { generation: { ...NO_USAGE, outputTokens: 50 } } : {},
      };
      return result;
    },
  };
}

describe('benchCompare', () => {
  it('runs every query through both flows, taking turns going first', async () => {
    const calls: string[] = [];
    const run = { ids: ['1'], totalMs: 1 };
    const runs = { q1: [run, run], q2: [run, run] };

    await benchCompare(
      QUERIES,
      [fakeFlow('main', runs, calls), fakeFlow('reference', runs, calls)],
      {
        runs: 2,
        draft: false,
      },
    );

    expect(calls).toEqual([
      'main:q1',
      'reference:q1',
      'reference:q2',
      'main:q2',
      'reference:q1',
      'main:q1',
      'main:q2',
      'reference:q2',
    ]);
  });

  it('summarises medians, relevance per run, source accuracy and LLM time', async () => {
    const main = fakeFlow(
      'main',
      {
        q1: [
          { ids: ['1', '9'], totalMs: 100, references: [3, 4] },
          { ids: ['1', '2'], totalMs: 300, references: [4, 4] },
          { ids: ['1', '2'], totalMs: 200, references: [1, 2] },
        ],
        q2: [
          { ids: ['3'], totalMs: 400, references: [0, 0] },
          { ids: ['9'], totalMs: 500, references: [0, 0] },
          { ids: ['3'], totalMs: 600, references: [0, 0] },
        ],
      },
      [],
      true,
    );

    const [summary] = await benchCompare(QUERIES, [main], { runs: 3, draft: true });

    expect(summary).toMatchObject({
      flow: 'main',
      configuration: 'main config',
      measured: {
        total: { median: 400, p90: 600 },
        translation: { median: 10, p90: 10 },
        // search 20 + rerank 30, without the translation
        sources: { median: 50, p90: 50 },
        search: { median: 20, p90: 20 },
        rerank: { median: 30, p90: 30 },
        generation: { median: 100, p90: 100 },
        // 100 ms over 50 output tokens
        generationPerToken: { median: 2, p90: 2 },
        outputTokens: { median: 50, p90: 50 },
        // translation 10 + generation 100 + a remote rerank's 30
        llm: { median: 140, p90: 140 },
        sourceAccuracy: 8 / 10,
      },
      samples: 6,
      queries: 2,
      drafts: 6,
      runs: 3,
      failures: 0,
    });
    // Run 1: q1 P 0.5 R 0.5, q2 P 1 R 1; run 2: q1 1 / 1, q2 0 / 0; run 3: q1 1 / 1, q2 1 / 1.
    expect(summary.measured?.relevance.precision).toBeCloseTo((0.75 + 0.5 + 1) / 3);
    expect(summary.measured?.relevance.recall).toBeCloseTo((0.75 + 0.5 + 1) / 3);
  });

  it('scores only the chunks that fit the context limits when a draft is written', async () => {
    const run: FakeRun = { ids: ['1', '2', '9'], sent: ['1'], totalMs: 1, references: [1, 1] };
    const flow = fakeFlow('reference', { q1: [run], q2: [{ ids: ['3'], totalMs: 1 }] }, []);

    const [summary] = await benchCompare([QUERIES[0]], [flow], { runs: 1, draft: true });

    expect(summary.measured?.relevance).toEqual({ precision: 1, recall: 0.5 });
  });

  it('leaves generation and source accuracy out without drafts, and a local rerank out of LLM time', async () => {
    const run: FakeRun = { ids: ['1'], totalMs: 50, references: [1, 1] };
    const flows = [
      fakeFlow('main', { q1: [run], q2: [run] }, []),
      fakeFlow('reference', { q1: [run], q2: [run] }, []),
    ];

    const [main, reference] = await benchCompare(QUERIES, flows, { runs: 1, draft: false });

    expect(main.measured?.generation).toBeUndefined();
    expect(main.measured?.sourceAccuracy).toBeNull();
    expect(main.drafts).toBe(0);
    expect(main.withoutDraft).toBeUndefined();
    expect(main.measured?.llm.median).toBe(10);
    expect(reference.measured?.rerank).toBeUndefined();
    expect(reference.measured?.llm.median).toBe(0);
  });

  it('compares the drafts only where both flows wrote one, and counts the pairs without', async () => {
    const flows = [
      fakeFlow(
        'main',
        {
          q1: [{ ids: ['1'], totalMs: 1, references: [1, 2] }],
          q2: [{ ids: ['3'], totalMs: 1, references: [3, 3] }],
        },
        [],
      ),
      fakeFlow(
        'reference',
        { q1: [{ ids: ['1'], totalMs: 1, references: [2, 2] }], q2: [{ ids: [], totalMs: 1 }] },
        [],
      ),
    ];

    const [main, reference] = await benchCompare(QUERIES, flows, { runs: 1, draft: true });

    expect(main).toMatchObject({ drafts: 2, withoutDraft: 0 });
    expect(reference).toMatchObject({ drafts: 1, withoutDraft: 1 });
    // q2's draft is the main flow's alone, so only q1's references count.
    expect(main.measured?.sourceAccuracy).toBe(1 / 2);
    expect(reference.measured?.sourceAccuracy).toBe(1);
  });

  it('counts a draft without text as no draft', async () => {
    const run: FakeRun = { ids: ['1'], totalMs: 1, references: [1, 1] };
    const flows = [
      fakeFlow('main', { q1: [run] }, []),
      fakeFlow('reference', { q1: [{ ...run, references: [0, 0], emptyDraft: true }] }, []),
    ];

    const [main, reference] = await benchCompare([QUERIES[0]], flows, { runs: 1, draft: true });

    expect(reference).toMatchObject({ drafts: 0, withoutDraft: 1 });
    expect(main.measured?.sourceAccuracy).toBeNull();
  });

  it('gives the median candidates judged and the unknown chunks over every pair', async () => {
    const main = fakeFlow(
      'main',
      {
        q1: [{ ids: ['1', '2', '3'], totalMs: 1, unknown: 2 }],
        q2: [{ ids: ['3'], totalMs: 1, unknown: 1 }],
      },
      [],
    );
    const reference = fakeFlow(
      'reference',
      { q1: [{ ids: ['1'], totalMs: 1 }], q2: [{ ids: ['3'], totalMs: 1 }] },
      [],
    );

    const [summary, unjudged] = await benchCompare(QUERIES, [main, reference], {
      runs: 1,
      draft: false,
    });

    expect(summary.measured).toMatchObject({ judgedCandidates: 3, unknown: 3 });
    expect(unjudged.measured?.judgedCandidates).toBeUndefined();
    expect(unjudged.measured?.unknown).toBeUndefined();
  });

  it('leaves a query and run that failed in one flow out of every flow', async () => {
    const failures: string[] = [];
    const flows = [
      fakeFlow('main', { q1: [{ ids: ['1'], totalMs: 70 }], q2: [] }, []),
      fakeFlow(
        'reference',
        { q1: [{ ids: ['1'], totalMs: 80 }], q2: [{ ids: ['3'], totalMs: 999 }] },
        [],
      ),
    ];

    const [main, reference] = await benchCompare(QUERIES, flows, {
      runs: 1,
      draft: false,
      onFailure: ({ flow, query, run, error }) =>
        failures.push(`${flow} ${query.id} ${run}: ${error}`),
    });

    expect(failures).toEqual(['main q2 0: no run 0 for q2']);
    expect(main).toMatchObject({
      failures: 1,
      samples: 1,
      queries: 1,
      measured: { total: { median: 70 } },
    });
    expect(reference).toMatchObject({
      failures: 0,
      samples: 1,
      measured: { total: { median: 80 } },
    });
  });

  it('has no measures for a flow whose every run failed', async () => {
    const main = fakeFlow('main', { q1: [], q2: [] }, []);

    const [summary] = await benchCompare(QUERIES, [main], { runs: 1, draft: true });

    expect(summary).toMatchObject({ samples: 0, queries: 0, failures: 2 });
    expect(summary.measured).toBeUndefined();
  });
});
