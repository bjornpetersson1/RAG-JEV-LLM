import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { runQuery, type QueryFlowDependencies } from '../generation/query-flow.js';
import { NO_USAGE, SILENT_LOGGER } from '../llm/client.js';
import { createFakeGenerator } from '../llm/fakes.js';
import type { Chunk } from '../llm/types.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import type { Reranker } from '../rerank/types.js';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from '../retrieval/test-helpers.js';
import { createDenseSearch } from './dense-search.js';
import { createReferenceFlow } from './setup.js';

const CHUNKS: Record<string, Chunk> = {
  '1': { id: '1', text: 'Ett', source: 'SFS 1982:80 1 §' },
  '2': { id: '2', text: 'Två', source: 'SFS 1982:80 2 §' },
  '3': { id: '3', text: 'Tre', source: 'SFS 1982:80 3 §' },
};

/**
 * The reference RAG's steps over three vectors (chunk 2 lies closest to every query, then 3, then
 * 1), judged from `scores`: relevant at 0.5 and above, at most `topK` kept.
 */
function fakeReference(candidates: number, scores: Record<string, number>, topK = 8) {
  const generated: string[][] = [];
  const judged: string[][] = [];
  const { embedder, embedded } = createFakeEmbedder(() => [1, 0]);
  const vectorIndex = {
    chunkIds: [1, 2, 3],
    dimensions: 2,
    vectors: Float32Array.from([0, 1, 1, 0, 0.8, 0.6]),
  };
  const deps: QueryFlowDependencies = {
    flow: 'reference',
    search: createDenseSearch(embedder, vectorIndex, candidates),
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
  return { deps, generated, judged, embedded };
}

describe('the reference RAG through runQuery', () => {
  it('embeds the instruction, judges the dense candidates and drafts from the approved ones', async () => {
    const { deps, generated, judged, embedded } = fakeReference(3, {
      '1': 0.9,
      '2': 0.2,
      '3': 0.6,
    });

    const result = await runQuery({ instruction: 'Säljare', template: 'employment' }, deps);

    expect(embedded).toEqual(['Säljare']);
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
    expect(result.timings.searchMs).toBeGreaterThanOrEqual(result.timings.embeddingMs ?? 0);
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

describe('createReferenceFlow', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  const ENV = { LLM_PROVIDER: 'fake', MAX_CANDIDATES: '3', MIN_TAG_CANDIDATES: '1' };
  const INSTRUCTION = 'Uppsägning ska vara sakligt grundad';

  async function embeddedDatabase() {
    const { db } = (database = createEvalDatabase());
    const { embedder } = createFakeEmbedder();
    await indexEmbeddings(db, embedder, FAKE_IDENTITY);
    return { db, embedder };
  }

  it('judges the MAX_CANDIDATES nearest chunks with the LLM judge and keeps RERANK_TOP_K', async () => {
    const { db, embedder } = await embeddedDatabase();

    const flow = createReferenceFlow(
      db,
      { ...ENV, RERANK_TOP_K: '1', JUDGE_THRESHOLD: '0.1' },
      SILENT_LOGGER,
      {},
      embedder,
    );
    const result = await runQuery({ instruction: INSTRUCTION, template: 'employment' }, flow);

    expect(flow.reranker.name).toBe('llm');
    expect(flow.configuration).toMatchObject({ reranker: expect.stringMatching(/^llm /), topK: 1 });
    expect(result.candidates).toBe(3);
    expect(result.judging?.judgeCalls).toBe(3);
    expect(result.approved).toHaveLength(1);
    expect(result.draft?.text).toContain('inte juridisk rådgivning');
  });

  it('writes no draft when no candidate reaches JUDGE_THRESHOLD', async () => {
    const { db, embedder } = await embeddedDatabase();

    const flow = createReferenceFlow(
      db,
      { ...ENV, JUDGE_THRESHOLD: '1' },
      SILENT_LOGGER,
      {},
      embedder,
    );
    // The fake judge scores the share of the instruction's words a chunk has; no chunk has "xylofon".
    const result = await runQuery({ instruction: 'xylofon', template: 'employment' }, flow);

    expect(result.judging?.relevant).toBe(0);
    expect(result.draft).toBeUndefined();
  });

  it('judges with the LLM also when RERANKER is another reranker', async () => {
    const { db, embedder } = await embeddedDatabase();

    const flow = createReferenceFlow(
      db,
      { ...ENV, RERANKER: 'minilm' },
      SILENT_LOGGER,
      {},
      embedder,
    );

    expect(flow.reranker.name).toBe('llm');
  });

  it("shares the main flow's reranker when it is the LLM judge, and only then", async () => {
    const { db, embedder } = await embeddedDatabase();
    const main = (name: string): Reranker => ({
      name,
      model: 'fake-model',
      rerank: async (_query, chunks) => fakeRerankResult(chunks, {}),
    });
    const llm = main('llm');
    const bge = main('bge');

    const shared = createReferenceFlow(db, ENV, SILENT_LOGGER, {}, embedder, llm);
    const own = createReferenceFlow(db, ENV, SILENT_LOGGER, {}, embedder, bge);

    expect(shared.reranker).toBe(llm);
    expect(own.reranker).not.toBe(bge);
    expect(own.reranker.name).toBe('llm');
  });

  it('fails, naming index:embed, before any chunk is embedded', () => {
    const { db } = (database = createEvalDatabase());

    expect(() =>
      createReferenceFlow(db, ENV, SILENT_LOGGER, {}, createFakeEmbedder().embedder),
    ).toThrow('run `npm run index:embed`');
  });
});
