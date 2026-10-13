import { describe, expect, it } from 'vitest';
import type { Chunk } from '../llm/types.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import type { Reranker } from '../rerank/types.js';
import type { ResolvedQuery } from './queries.js';
import {
  chooseSetting,
  keptChunks,
  sweepCandidates,
  SWEEP_CANDIDATES,
  SWEEP_TOP_K,
  type CandidateSweepRow,
  type SweptRetriever,
} from './sweep.js';

/** 60 chunk ids; the fake reranker scores chunk i as (i % 7) / 7, relevant from 0.5. */
const IDS = Array.from({ length: 60 }, (_, i) => String(i + 1));
const score = (id: string) => (Number(id) % 7) / 7;

const reranker: Reranker = {
  name: 'fake',
  model: 'fake-model',
  async rerank(_query, chunks, topK) {
    const scores = Object.fromEntries(chunks.map(({ id }) => [id, score(id)]));
    return fakeRerankResult(chunks, scores, { topK, stats: { elapsedMs: chunks.length * 10 } });
  },
};

const QUERY: ResolvedQuery = {
  id: 'q1',
  kind: 'employment',
  instruction: 'A',
  relevant: [],
  relevantIds: new Set(['4', '5', '6', '11', '12', '13', '40']),
  centralIds: new Set(['5', '6']),
};

const retriever: SweptRetriever = {
  name: 'tags',
  usesTags: true,
  retrieve: async (_query, _tags, candidates) => IDS.slice(0, candidates),
};

const loadChunks = (ids: readonly string[]): Chunk[] => ids.map((id) => ({ id, text: id }));

describe('keptChunks', () => {
  it.each(SWEEP_CANDIDATES.flatMap((n) => SWEEP_TOP_K.map((k) => [n, k])))(
    'with %d candidates and top %d gives what reranking that list alone gives',
    async (candidates, topK) => {
      // The union holds every id; the list is its last N, so not a prefix of the union.
      const given = IDS.slice(IDS.length - candidates);
      const union = await reranker.rerank('A', loadChunks(IDS), IDS.length);
      const direct = await reranker.rerank('A', loadChunks(given), topK);

      expect(
        keptChunks(
          union.ranked.map(({ chunk }) => chunk.id),
          given,
          topK,
        ),
      ).toEqual(direct.ranked.map(({ chunk }) => chunk.id));
    },
  );
});

describe('sweepCandidates', () => {
  it('reranks the union of each query’s lists once and measures every setting from it', async () => {
    const reranked: number[] = [];
    const rows = await sweepCandidates([QUERY], {
      retrievers: [retriever],
      reranker: {
        ...reranker,
        rerank: (query, chunks, topK) => {
          reranked.push(chunks.length);
          return reranker.rerank(query, chunks, topK);
        },
      },
      translate: async () => ['tag'],
      loadChunks,
    });

    // The lists of every count are prefixes here, so their union is the list of 50.
    expect(reranked).toEqual([50]);
    expect(rows).toHaveLength(SWEEP_CANDIDATES.length * SWEEP_TOP_K.length);
    // 10 candidates, top 5: chunks 6, 5, 4 (scores 6/7, 5/7, 4/7); 4, 5 and 6 are relevant, 5 and 6 central.
    const row = rows.find(({ candidates, topK }) => candidates === 10 && topK === 5);
    expect(row).toMatchObject({
      retriever: 'tags',
      scores: {
        central: { precision: 2 / 3, recall: 1 },
        all: { precision: 1, recall: 3 / 7 },
      },
      rerankMs: { median: 100 },
      queries: 1,
    });
  });

  it('leaves a query out when it fails, and reports it', async () => {
    const failures: string[] = [];
    const rows = await sweepCandidates([QUERY], {
      retrievers: [retriever],
      reranker,
      translate: () => Promise.reject(new Error('translator down')),
      loadChunks,
      onFailure: (step, query, error) => failures.push(`${query.id} ${step}: ${error}`),
    });

    expect(failures).toEqual(['q1 sweep: translator down']);
    expect(rows[0].queries).toBe(0);
  });
});

describe('a retriever whose lists are not prefixes of each other', () => {
  it('measures each count on the list that count gives', async () => {
    // At 10 the retriever gives chunks 41-50; at more, the first N of 1-60.
    const shifting: SweptRetriever = {
      name: 'both',
      usesTags: false,
      retrieve: async (_query, _tags, candidates) =>
        candidates === 10 ? IDS.slice(40, 50) : IDS.slice(0, candidates),
    };

    const rows = await sweepCandidates([QUERY], {
      retrievers: [shifting],
      reranker,
      translate: async () => [],
      loadChunks,
    });

    // No relevant chunk is among 41-50, so nothing relevant is kept at 10.
    const row10 = rows.find(({ candidates, topK }) => candidates === 10 && topK === 12);
    expect(row10?.scores.all.recall).toBe(0);
    const row20 = rows.find(({ candidates, topK }) => candidates === 20 && topK === 12);
    expect(row20?.scores.all.recall).toBeGreaterThan(0);
  });
});

describe('chooseSetting', () => {
  function row(candidates: number, topK: number, recall: number, f1: number): CandidateSweepRow {
    const scores = { precision: 0, recall, f1 };
    return {
      retriever: 'tags',
      candidates,
      topK,
      scores: { central: scores, all: scores },
      rerankMs: { median: 0, p90: 0 },
      queries: 20,
    };
  }

  it('takes the best central F1 among the rows within the recall floor of the baseline', () => {
    const baseline = row(30, 8, 0.5, 0.3);
    const tooLowRecall = row(10, 5, 0.46, 0.5);
    const best = row(20, 8, 0.48, 0.4);

    const [choice] = chooseSetting([baseline, tooLowRecall, best], {
      tags: { candidates: 30, topK: 8 },
    });

    expect(choice).toEqual({ retriever: 'tags', baseline, chosen: best });
  });

  it('prefers fewer candidates on a tie within 0.01', () => {
    const baseline = row(30, 8, 0.5, 0.4);
    const fewer = row(20, 10, 0.5, 0.395);

    const [choice] = chooseSetting([baseline, fewer], { tags: { candidates: 30, topK: 8 } });

    expect(choice.chosen).toBe(fewer);
  });

  it('takes the best central F1 among the rows with the fewest candidates', () => {
    const baseline = row(30, 8, 0.5, 0.4);
    const fewerKept = row(20, 8, 0.5, 0.392);
    const moreKept = row(20, 10, 0.5, 0.398);

    const [choice] = chooseSetting([baseline, fewerKept, moreKept], {
      tags: { candidates: 30, topK: 8 },
    });

    expect(choice.chosen).toBe(moreKept);
  });

  it('makes no choice when no query was measured', () => {
    const unmeasured = { ...row(30, 8, 0, 0), queries: 0 };

    expect(chooseSetting([unmeasured], { tags: { candidates: 30, topK: 8 } })).toEqual([]);
  });
});
