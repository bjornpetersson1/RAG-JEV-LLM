import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { NO_USAGE, SILENT_LOGGER } from '../llm/client.js';
import { loadLlmConfig } from '../llm/config.js';
import { createFakeGenerator } from '../llm/fakes.js';
import { createReranker } from '../rerank/factory.js';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder } from '../retrieval/test-helpers.js';
import type { Chunk } from '../llm/types.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import { runQuery, type QueryFlowDependencies } from './query-flow.js';
import { createQueryFlow } from './setup.js';

const USAGE = { inputTokens: 7, outputTokens: 3, cacheWriteTokens: 0, cacheReadTokens: 0 };

const CHUNKS: Record<string, Chunk> = {
  '1': { id: '1', text: 'Ett', source: 'SFS 1982:80 1 §' },
  '2': { id: '2', text: 'Två', source: 'SFS 1982:80 2 §' },
  '3': { id: '3', text: 'Tre', source: 'SFS 1982:80 3 §' },
};

function fakeFlow(scores: Record<string, number>) {
  const calls = { judged: [] as string[], generated: [] as string[][] };
  const deps: QueryFlowDependencies = {
    async translate() {
      return { tags: [{ slug: 'uppsagning', origin: 'translated' }], usage: USAGE, elapsedMs: 12 };
    },
    search: async () => ({
      candidates: ['1', '2', '3'].map((id) => ({ chunkId: Number(id), origin: 'tag' as const })),
      tagCandidates: 3,
      fallbackUsed: false,
      ftsAdded: 0,
      ftsQuery: null,
    }),
    loadChunks: (ids) => ids.map((id) => CHUNKS[id]),
    async rerank(_instruction, chunks) {
      calls.judged.push(...chunks.map((c) => c.id));
      return fakeRerankResult(chunks, scores, {
        stats: { calls: 2, cacheHits: 1, usage: USAGE, elapsedMs: 40 },
      });
    },
    generator: createFakeGenerator((input) => {
      calls.generated.push(input.chunks.map((c) => c.id));
      return input.chunks.map((c) => `Klausul [K:${c.id}].`).join('\n');
    }),
    limits: { maxChunks: 20, maxContextChars: 60_000 },
  };
  return { deps, calls };
}

describe('runQuery', () => {
  it('runs translation → search → judging → draft and reports each step', async () => {
    const { deps, calls } = fakeFlow({ '1': 0.6, '2': 0.9, '3': 0.2 });

    const result = await runQuery({ instruction: 'Säljare', template: 'employment' }, deps);

    expect(calls.judged).toEqual(['1', '2', '3']);
    expect(calls.generated).toEqual([['2', '1']]);
    expect(result.tags).toEqual(['uppsagning']);
    expect(result.candidates).toBe(3);
    expect(result.judging).toEqual({
      approved: 2,
      relevant: 2,
      cacheHits: 1,
      judgeCalls: 2,
      unknown: 0,
    });
    expect(result.draft?.used.map((c) => c.id)).toEqual(['2', '1']);
    expect(result.draft?.check).toMatchObject({ flags: [], references: 2, sourceAccuracy: 1 });
    expect(result.timings).toMatchObject({ translationMs: 12, judgingMs: 40 });
    expect(result.timings.searchMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.generationMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.generationMs ?? 0);
    expect(result.usage).toEqual({ translation: USAGE, judging: USAGE, generation: NO_USAGE });
  });

  it('stops before generation when nothing is approved', async () => {
    const { deps, calls } = fakeFlow({ '1': 0.1, '2': 0.4 });

    const result = await runQuery({ instruction: 'Säljare', template: 'nda' }, deps);

    expect(calls.generated).toEqual([]);
    expect(result.draft).toBeUndefined();
    expect(result.judging).toMatchObject({ approved: 0, unknown: 1 });
    expect(result.timings.generationMs).toBeUndefined();
    expect(result.usage.generation).toBeUndefined();
  });
});

describe('switching the reranker to JEV', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('takes only RERANKER=jev and JEV_API_KEY, with no other change to the query flow', async () => {
    database = createEvalDatabase();
    const jevCalls: string[] = [];
    const fakeJev = (async (url: string | URL | Request) => {
      jevCalls.push(String(url));
      return Response.json({ answers: { relevant: { type: 'noul', noul: 0.9 } }, usage: {} });
    }) as typeof globalThis.fetch;
    const env = { RERANKER: 'jev', JEV_API_KEY: 'k', JUDGE_CACHE: 'off' };
    const { reranker, topK } = createReranker(env, {
      db: database.db,
      llmConfig: loadLlmConfig({ LLM_PROVIDER: 'fake' }),
      logger: SILENT_LOGGER,
      fetch: fakeJev,
    });
    const { deps } = fakeFlow({});

    const result = await runQuery(
      { instruction: 'Säljare', template: 'employment' },
      { ...deps, rerank: (instruction, chunks) => reranker.rerank(instruction, chunks, topK) },
    );

    expect(reranker.name).toBe('jev');
    expect(jevCalls).toEqual(Array(3).fill('https://api.typesafe.ai/v1/systemone'));
    expect(result.judging).toMatchObject({ approved: 3, judgeCalls: 3 });
    expect(result.draft?.used).toHaveLength(3);
  });
});

describe('createQueryFlow', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  const ENV = {
    LLM_PROVIDER: 'fake',
    QUERY_TRANSLATOR_IMPL: 'llm',
    RERANKER: 'llm',
    JUDGE_CACHE: 'off',
  };
  const logger = SILENT_LOGGER;

  it('runs the whole chain from .env with fake roles and a test database', async () => {
    database = createEvalDatabase();
    const flow = createQueryFlow(database.db, { ...ENV, DATABASE_PATH: database.path }, logger, {
      maxChunks: 1,
    });

    const result = await runQuery(
      { instruction: 'Uppsägning ska vara sakligt grundad', template: 'employment' },
      flow,
    );

    expect(result.candidates).toBeGreaterThan(0);
    expect(result.draft?.used.map((c) => c.id)).toEqual(['11']);
    expect(result.draft?.used[0].source).toBe('SFS 1982:80 7 §');
    expect(result.draft?.context.limits).toEqual({ maxChunks: 1, maxContextChars: 60_000 });
    expect(result.draft?.text).toContain('inte juridisk rådgivning');
    expect(result.draft?.check).toMatchObject({ flags: [], sourceAccuracy: 1 });
  });

  it.each([
    ['tags', true],
    ['bge', false],
    ['both', true],
  ])('works with RETRIEVER=%s (query translated: %s)', async (retriever, translated) => {
    database = createEvalDatabase();
    const { embedder } = createFakeEmbedder();
    await indexEmbeddings(database.db, embedder, { model: embedder.model, dtype: 'int8' });

    const flow = createQueryFlow(
      database.db,
      { ...ENV, DATABASE_PATH: database.path, RETRIEVER: retriever },
      logger,
      { maxChunks: 1 },
      embedder,
    );
    const result = await runQuery(
      { instruction: 'Uppsägning ska vara sakligt grundad', template: 'employment' },
      flow,
    );

    expect(flow.translate !== undefined).toBe(translated);
    expect(result.tags.length > 0).toBe(translated);
    if (!translated) expect(result.timings.translationMs).toBe(0);
    expect(result.candidates).toBeGreaterThan(0);
    expect(result.draft?.text).toContain('inte juridisk rådgivning');
  });

  it('fails for bge, naming index:embed, before any chunk is embedded', () => {
    database = createEvalDatabase();

    expect(() =>
      createQueryFlow(
        database!.db,
        { ...ENV, DATABASE_PATH: database!.path, RETRIEVER: 'bge' },
        logger,
        {},
        createFakeEmbedder().embedder,
      ),
    ).toThrow('run `npm run index:embed`');
  });
});
