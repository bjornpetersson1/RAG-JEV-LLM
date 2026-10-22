import { afterEach, describe, expect, it, vi } from 'vitest';
import { SILENT_LOGGER } from '../llm/client.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import type { Reranker } from '../rerank/types.js';
import { compareRerankers, type ComparedRetriever } from './compare.js';
import { createCompareSetup } from './compare-setup.js';
import type { ResolvedQuery } from './queries.js';
import { createEvalDatabase } from './test-helpers.js';

/** Two queries; q1 has relevant chunks 1 (central) and 2 (related), q2 has central chunk 5. */
const QUERIES: ResolvedQuery[] = [
  {
    id: 'q1',
    kind: 'employment',
    instruction: 'A',
    relevant: [],
    relevantIds: new Set(['1', '2']),
    centralIds: new Set(['1']),
  },
  {
    id: 'q2',
    kind: 'nda',
    instruction: 'B',
    relevant: [],
    relevantIds: new Set(['5']),
    centralIds: new Set(['5']),
  },
];

/** The retriever's order: relevant chunks late, so reranking can lift them. */
const RETRIEVED: Record<string, string[]> = {
  A: ['9', '8', '7', '6', '4', '3', '1', '2'],
  B: ['5', '6'],
};

const retriever: ComparedRetriever = {
  name: 'fts',
  usesTags: false,
  retrieve: async (query) => ({ ids: RETRIEVED[query.instruction], elapsedMs: 10 }),
};

/** Scores relevant chunks highest; the stats say whether the cache answered. */
function fakeReranker(cacheHits: number, elapsedMs: number): Reranker {
  return {
    name: 'fake',
    model: 'fake-model',
    rerank: vi.fn(async (_query, chunks, topK) =>
      fakeRerankResult(
        chunks,
        { 1: 0.9, 2: 0.8, 5: 0.9, 9: 0.6, 6: 0.55 },
        {
          topK,
          stats: { cacheHits, elapsedMs },
        },
      ),
    ),
  };
}

const deps = (rerankers: Parameters<typeof compareRerankers>[1]['rerankers']) => ({
  retrievers: [retriever],
  rerankers,
  translate: async () => [],
  translator: 'llm-model',
  loadChunks: (ids: readonly string[]) => ids.map((id) => ({ id, text: id })),
  latencyQueries: 1,
});

describe('compareRerankers', () => {
  it('gives recall@K before and after rerank, precision@5/@10 and latency', async () => {
    const reranker = fakeReranker(0, 40);

    const [before, after] = await compareRerankers(
      QUERIES,
      deps([{ name: 'fake', cached: reranker, uncached: () => reranker }]),
    );

    // q1: 1 and 2 are 7th and 8th; q2: 5 is first.
    expect(before).toMatchObject({
      retriever: 'fts',
      reranker: 'none',
      candidates: 5,
      before: {
        all: { '5': 0.5, '8': 1, '10': 1, candidates: 1, precision5: 0.1 },
        central: { '5': 0.5, '8': 1, '10': 1, candidates: 1, precision5: 0.1 },
      },
      queries: 2,
    });
    // After: q1 keeps 1, 2, 9, 6 (relevant at 0.5 and above); q2 keeps 5, 6.
    expect(after).toMatchObject({
      reranker: 'fake',
      model: 'fake-model',
      after: {
        all: {
          '5': 1,
          '8': 1,
          '10': 1,
          candidates: 1,
          precision5: expect.closeTo(0.3, 10),
          precision10: expect.closeTo(0.15, 10),
        },
        // Only chunk 1 of q1 is central, so q1's precision halves.
        central: {
          '5': 1,
          precision5: expect.closeTo(0.2, 10),
          precision10: expect.closeTo(0.1, 10),
        },
      },
      rerankMs: { median: 40, p90: 40 },
      retrievalMs: { median: 10, p90: 10 },
      queries: 2,
      notes: [],
    });
  });

  it('times a reranker that hit its cache again with the cache off', async () => {
    const cached = fakeReranker(3, 1);
    const uncached = fakeReranker(0, 900);

    const [, row] = await compareRerankers(
      QUERIES,
      deps([{ name: 'fake', cached, uncached: () => uncached }]),
    );

    expect(uncached.rerank).toHaveBeenCalledOnce();
    expect(row.rerankMs).toEqual({ median: 900, p90: 900 });
    expect(row.notes).toEqual(['rerank latency from a cache-off pass over 1 queries']);
  });

  it('takes the latency from the queries without cache hits when there are enough', async () => {
    const reranker: Reranker = {
      name: 'fake',
      model: 'm',
      rerank: async (query, chunks, topK) =>
        fakeRerankResult(
          chunks,
          {},
          {
            topK,
            stats: query === 'A' ? { cacheHits: 0, elapsedMs: 70 } : { cacheHits: 2, elapsedMs: 1 },
          },
        ),
    };
    const uncached = vi.fn(() => reranker);

    const [, row] = await compareRerankers(
      QUERIES,
      deps([{ name: 'fake', cached: reranker, uncached }]),
    );

    expect(uncached).not.toHaveBeenCalled();
    expect(row.rerankMs).toEqual({ median: 70, p90: 70 });
    expect(row.notes).toEqual(['rerank latency from the 1 queries without cache hits']);
  });

  it('lists a reranker that cannot be built, or fails on every query, as skipped', async () => {
    const failing: Reranker = {
      name: 'broken',
      model: 'b',
      rerank: () => Promise.reject(new Error('model unavailable')),
    };

    const rows = await compareRerankers(
      QUERIES,
      deps([
        { name: 'jev', skipped: 'JEV_API_KEY is required because RERANKER is jev' },
        { name: 'broken', cached: failing, uncached: () => failing },
      ]),
    );

    expect(rows.map(({ reranker, queries, notes }) => ({ reranker, queries, notes }))).toEqual([
      { reranker: 'none', queries: 2, notes: [] },
      {
        reranker: 'jev',
        queries: 0,
        notes: ['skipped: JEV_API_KEY is required because RERANKER is jev'],
      },
      { reranker: 'broken', queries: 0, notes: ['skipped: model unavailable'] },
    ]);
    expect(rows.some(({ failed }) => failed)).toBe(false);
  });

  it('averages before and after over the same queries', async () => {
    const order: string[] = [];
    const reranker: Reranker = {
      name: 'fake',
      model: 'm',
      rerank: async (query, chunks, topK) => {
        order.push(`rerank ${query}`);
        if (query === 'B') throw new Error('timeout');
        return fakeRerankResult(chunks, { 1: 0.9, 2: 0.8 }, { topK });
      },
    };
    const failures: string[] = [];

    const [, row] = await compareRerankers(QUERIES, {
      ...deps([{ name: 'fake', cached: reranker, uncached: () => reranker }]),
      onFailure: (step, query, error) => failures.push(`${query.id} ${step}: ${error}`),
    });

    expect(failures).toEqual(['q2 rerank fake: timeout']);
    // Only q1 was reranked, so "before" covers q1 alone: 1 and 2 are 7th and 8th.
    expect(row).toMatchObject({ queries: 1, before: { all: { '5': 0, '8': 1 } }, failed: true });
    expect(row.notes).toEqual(['rerank failed for 1 queries']);
  });

  it('counts failures in a row per retriever, so one bad query does not end a reranker', async () => {
    let calls = 0;
    const flaky: Reranker = {
      name: 'fake',
      model: 'm',
      rerank: async (_query, chunks, topK) => {
        calls += 1;
        if (calls <= 3) throw new Error('model download failed');
        return fakeRerankResult(chunks, {}, { topK });
      },
    };
    const three = ['a', 'b', 'c'].map((name) => ({ ...retriever, name }));

    const rows = await compareRerankers(QUERIES, {
      ...deps([{ name: 'fake', cached: flaky, uncached: () => flaky }]),
      retrievers: three,
    });

    // Query 1 failed on all three retrievers; query 2 still ran on each.
    expect(
      rows.filter(({ reranker }) => reranker === 'fake').map(({ queries }) => queries),
    ).toEqual([1, 1, 1]);
  });

  it('reports no latency when every cache-off rerank fails', async () => {
    const cached = fakeReranker(3, 1);
    const broken: Reranker = {
      name: 'fake',
      model: 'm',
      rerank: () => Promise.reject(new Error('down')),
    };

    const [, row] = await compareRerankers(
      QUERIES,
      deps([{ name: 'fake', cached, uncached: () => broken }]),
    );

    expect(row.rerankMs).toBeUndefined();
    expect(row.failed).toBe(true);
    expect(row.notes).toEqual(['rerank latency not measured: every cache-off rerank failed']);
  });

  it('only lists a baseline retriever, never reranking it', async () => {
    const reranker = fakeReranker(0, 1);
    const baseline: ComparedRetriever = { ...retriever, name: 'fts', baseline: true };

    const rows = await compareRerankers(QUERIES, {
      ...deps([{ name: 'fake', cached: reranker, uncached: () => reranker }]),
      retrievers: [baseline],
    });

    expect(
      rows.map(({ retriever: name, reranker: rerankerName }) => `${name}/${rerankerName}`),
    ).toEqual(['fts/none']);
    expect(reranker.rerank).not.toHaveBeenCalled();
  });
});

describe('createCompareSetup', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('skips jev and subq without a key, and still compares llm, without crashing', async () => {
    database = createEvalDatabase();
    const env = {
      DATABASE_PATH: database.path,
      LLM_PROVIDER: 'fake',
      QUERY_TRANSLATOR_IMPL: 'llm',
      JUDGE_THRESHOLD: '0',
    };
    const query = { instruction: 'Uppsägning ska vara sakligt grundad', relevant: [] };
    const queries: ResolvedQuery[] = [
      {
        ...query,
        id: 'q1',
        kind: 'employment',
        template: 'employment',
        relevantIds: new Set(['11']),
        centralIds: new Set(['11']),
      },
      {
        ...query,
        id: 'q2',
        kind: 'nda',
        relevantIds: new Set(['11']),
        centralIds: new Set(['11']),
      },
    ];
    const setup = createCompareSetup(database.db, env, SILENT_LOGGER, ['jev', 'subq', 'llm']);

    const rows = await compareRerankers(queries, setup);

    expect(
      rows.map(({ retriever, reranker, notes }) => [retriever, reranker, notes[0] ?? '']),
    ).toEqual([
      ['tags', 'none', ''],
      ['tags', 'jev', 'skipped: JEV_API_KEY is required because RERANKER is jev'],
      ['tags', 'subq', 'skipped: SUBQ_API_KEY is required because RERANKER is subq'],
      ['tags', 'llm', expect.any(String)],
      ['fts', 'none', ''],
    ]);
    expect(rows[3].queries).toBe(2);
  });

  it('names the translator and times it for a retriever that uses tags, not for one without', async () => {
    const reranker = fakeReranker(0, 40);
    const tagRetriever: ComparedRetriever = { ...retriever, name: 'tags', usesTags: true };

    const rows = await compareRerankers(QUERIES, {
      ...deps([{ name: 'fake', cached: reranker, uncached: () => reranker }]),
      retrievers: [tagRetriever, retriever],
    });

    const [tagsBefore, tagsAfter, ftsBefore] = rows;
    expect(tagsBefore).toMatchObject({
      translator: 'llm-model',
      translationMs: expect.any(Object),
    });
    expect(tagsAfter.translator).toBe('llm-model');
    expect(tagsAfter.translationMs?.median).toBeGreaterThanOrEqual(0);
    expect(ftsBefore).toMatchObject({ retriever: 'fts', translator: '–' });
    expect(ftsBefore.translationMs).toBeUndefined();
  });
});
