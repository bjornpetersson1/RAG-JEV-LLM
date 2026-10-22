import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { runQuery, type QueryFlowDependencies } from '../generation/query-flow.js';
import { NO_USAGE, SILENT_LOGGER } from '../llm/client.js';
import { createFakeGenerator } from '../llm/fakes.js';
import type { Chunk } from '../llm/types.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import type { Reranker } from '../rerank/types.js';
import { createLexicalSearch } from './lexical-search.js';
import { createReferenceFlow, REFERENCE_RETRIEVER } from './setup.js';

const CHUNKS: Record<string, Chunk> = {
  '1': { id: '1', text: 'Ett', source: 'SFS 1982:80 1 §' },
  '2': { id: '2', text: 'Två', source: 'SFS 1982:80 2 §' },
  '3': { id: '3', text: 'Tre', source: 'SFS 1982:80 3 §' },
};

/**
 * The reference RAG's steps over three candidates (chunk 2 first, then 3, then 1), judged from
 * `scores`: relevant at 0.5 and above, at most `topK` kept.
 */
function fakeReference(candidates: number, scores: Record<string, number>, topK = 8) {
  const generated: string[][] = [];
  const judged: string[][] = [];
  const searched: string[] = [];
  const deps: QueryFlowDependencies = {
    flow: 'reference',
    search: async (instruction) => {
      searched.push(instruction);
      return {
        candidates: [2, 3, 1]
          .slice(0, candidates)
          .map((chunkId) => ({ chunkId, origin: 'lexical' as const })),
      };
    },
    loadChunks: (ids) => ids.map((id) => CHUNKS[id]),
    rerank: async (_instruction, chunks) => {
      judged.push(chunks.map((c) => c.id));
      return fakeRerankResult(chunks, scores, {
        topK,
        stats: { elapsedMs: 30, calls: chunks.length },
      });
    },
    generator: createFakeGenerator((input) => {
      generated.push(input.chunks.map((c) => c.id));
      return input.chunks.map((c) => `Klausul [K:${c.id}].`).join('\n');
    }),
    limits: { maxChunks: 20, maxContextChars: 60_000 },
  };
  return { deps, generated, judged, searched };
}

describe('the reference RAG through runQuery', () => {
  it('searches with the instruction, judges the candidates and drafts from the approved ones', async () => {
    const { deps, generated, judged, searched } = fakeReference(3, {
      '1': 0.9,
      '2': 0.2,
      '3': 0.6,
    });

    const result = await runQuery({ instruction: 'Säljare', template: 'employment' }, deps);

    expect(searched).toEqual(['Säljare']);
    expect(judged).toEqual([['2', '3', '1']]);
    expect(generated).toEqual([['1', '3']]);
    expect(result.flow).toBe('reference');
    expect(result.tags).toEqual([]);
    expect(result.candidates).toBe(3);
    expect(result.approved.map((c) => c.id)).toEqual(['1', '3']);
    expect(result.judging).toEqual({ relevant: 2, cacheHits: 0, judgeCalls: 3, unknown: 0 });
    expect(result.sources.map(({ chunk, status }) => [chunk.id, status])).toEqual([
      ['2', 'turned-down'],
      ['3', 'cited'],
      ['1', 'cited'],
    ]);
    expect(result.draft?.check).toMatchObject({ flags: [], references: 2, sourceAccuracy: 1 });
    expect(result.timings.translationMs).toBeUndefined();
    expect(result.timings.judgingMs).toBe(30);
    expect(result.timings.sourcesMs).toBe(result.timings.searchMs + 30);
    expect(result.usage).toEqual({ judging: NO_USAGE, generation: NO_USAGE });
  });

  it('keeps at most RERANK_TOP_K of the relevant chunks', async () => {
    const { deps, generated } = fakeReference(3, { '1': 0.9, '2': 0.8, '3': 0.7 }, 2);

    await runQuery({ instruction: 'Säljare', template: 'employment' }, deps);

    expect(generated).toEqual([['1', '2']]);
  });

  it('writes no draft when the judge approves nothing', async () => {
    const { deps, generated } = fakeReference(2, { '2': 0.1, '3': 0.4 });

    const result = await runQuery({ instruction: 'Säljare', template: 'nda' }, deps);

    expect(generated).toEqual([]);
    expect(result.approved).toEqual([]);
    expect(result.draft).toBeUndefined();
    expect(result.judging?.relevant).toBe(0);
    expect(result.sources.every(({ status }) => status === 'turned-down')).toBe(true);
  });

  it('measures retrieval and judging alone when no draft is asked for', async () => {
    const { deps, generated } = fakeReference(3, { '1': 0.9, '2': 0.8, '3': 0.7 });

    const result = await runQuery({ instruction: 'Säljare', template: 'nda' }, deps, {
      draft: false,
    });

    expect(generated).toEqual([]);
    expect(result.approved.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(result.draft).toBeUndefined();
    expect(result.timings.generationMs).toBeUndefined();
  });
});

describe('createLexicalSearch', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('gives the chunks BM25 ranks best, a chunk with the instruction’s words first', async () => {
    database = createEvalDatabase();

    const { candidates } = await createLexicalSearch(database.db, 3)(
      'sakligt grundad uppsägning',
      [],
    );

    expect(candidates[0]).toEqual({ chunkId: 11, origin: 'lexical' });
    expect(candidates.length).toBeLessThanOrEqual(3);
  });
});

describe('createReferenceFlow', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  const ENV = { LLM_PROVIDER: 'fake', MAX_CANDIDATES: '3', MIN_TAG_CANDIDATES: '1' };
  const INSTRUCTION = 'Uppsägning ska vara sakligt grundad';

  function openDatabase() {
    return (database = createEvalDatabase()).db;
  }

  it('judges the MAX_CANDIDATES best BM25 chunks with the LLM judge and keeps RERANK_TOP_K', async () => {
    const db = openDatabase();

    // BM25 finds chunks 11 and 21 for these words; MAX_CANDIDATES 1 keeps the best.
    const flow = createReferenceFlow(
      db,
      { ...ENV, MAX_CANDIDATES: '1', RERANK_TOP_K: '1', JUDGE_THRESHOLD: '0.1' },
      SILENT_LOGGER,
    );
    const result = await runQuery(
      { instruction: `${INSTRUCTION}, konkurrensklausulen oskälig`, template: 'employment' },
      flow,
    );

    expect(flow.reranker.name).toBe('llm');
    expect(flow.configuration).toMatchObject({
      retriever: REFERENCE_RETRIEVER,
      reranker: expect.stringMatching(/^llm /),
      topK: 1,
    });
    expect(result.candidates).toBe(1);
    expect(result.judging?.judgeCalls).toBe(1);
    expect(result.approved).toHaveLength(1);
    expect(result.draft?.text).toContain('inte juridisk rådgivning');
  });

  it('writes no draft when no candidate reaches JUDGE_THRESHOLD', async () => {
    const flow = createReferenceFlow(
      openDatabase(),
      { ...ENV, JUDGE_THRESHOLD: '1' },
      SILENT_LOGGER,
    );
    // The fake judge scores the share of the instruction's words a chunk has; no chunk has "xylofon".
    const result = await runQuery({ instruction: 'xylofon', template: 'employment' }, flow);

    expect(result.judging?.relevant).toBe(0);
    expect(result.draft).toBeUndefined();
  });

  it('judges with the LLM also when RERANKER is another reranker', async () => {
    const flow = createReferenceFlow(openDatabase(), { ...ENV, RERANKER: 'subq' }, SILENT_LOGGER);

    expect(flow.reranker.name).toBe('llm');
  });

  it("shares the main flow's reranker when it is the LLM judge, and only then", async () => {
    const db = openDatabase();
    const main = (name: string): Reranker => ({
      name,
      model: 'fake-model',
      rerank: async (_query, chunks) => fakeRerankResult(chunks, {}),
    });
    const llm = main('llm');
    const subq = main('subq');

    const shared = createReferenceFlow(db, ENV, SILENT_LOGGER, {}, llm);
    const own = createReferenceFlow(db, ENV, SILENT_LOGGER, {}, subq);

    expect(shared.reranker).toBe(llm);
    expect(own.reranker).not.toBe(subq);
    expect(own.reranker.name).toBe('llm');
  });
});
