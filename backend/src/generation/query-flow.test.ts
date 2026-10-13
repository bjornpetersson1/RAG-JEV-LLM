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
import { runQuery, type QueryFlowDependencies, type QueryStep } from './query-flow.js';
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
    expect(result.approved.map((c) => c.id)).toEqual(['2', '1']);
    expect(result.judging).toEqual({
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

  it('reports the approved chunks and the time the search spent embedding', async () => {
    const { deps } = fakeFlow({ '1': 0.6, '2': 0.9, '3': 0.2 });
    const search = deps.search;

    const result = await runQuery(
      { instruction: 'Säljare', template: 'employment' },
      { ...deps, search: async (...args) => ({ ...(await search(...args)), embedMs: 25 }) },
    );

    expect(result.flow).toBe('main');
    expect(result.approved.map((c) => c.id)).toEqual(['2', '1']);
    expect(result.timings.embeddingMs).toBe(25);
  });

  it('lists every candidate as a source, with its origin and the reranker’s score', async () => {
    const { deps } = fakeFlow({ '1': 0.6, '2': 0.9 });

    const result = await runQuery({ instruction: 'Säljare', template: 'employment' }, deps);

    // The fake generator cites every chunk it gets.
    expect(result.sources).toEqual([
      { chunk: CHUNKS['1'], status: 'cited', origin: 'tag', score: 0.6, reranker: 'fake' },
      { chunk: CHUNKS['2'], status: 'cited', origin: 'tag', score: 0.9, reranker: 'fake' },
      { chunk: CHUNKS['3'], status: 'turned-down', origin: 'tag' },
    ]);
  });

  it.each([
    ['a draft that cites one of two sent chunks', true, 20, 'Klausul [K:2].', ['sent', 'cited']],
    [
      'a draft that names the other in free text',
      true,
      20,
      'Klausul [K:2]. Enligt 1 § LAS.',
      ['cited', 'cited'],
    ],
    ['the context limit keeping one out', true, 1, 'Klausul [K:2].', ['left-out', 'cited']],
    ['no draft asked for', false, 20, '', ['left-out', 'left-out']],
  ])(
    'gives each approved source its status after %s',
    async (_case, draft, maxChunks, answer, expected) => {
      const { deps } = fakeFlow({ '1': 0.6, '2': 0.9 });

      const result = await runQuery(
        { instruction: 'Säljare', template: 'employment' },
        {
          ...deps,
          generator: createFakeGenerator(() => answer),
          limits: { ...deps.limits, maxChunks },
        },
        { draft },
      );

      expect(result.sources.slice(0, 2).map(({ status }) => status)).toEqual(expected);
    },
  );

  it('reports the time to sources: search plus rerank, without the translation', async () => {
    const { deps } = fakeFlow({ '1': 0.6, '2': 0.9, '3': 0.2 });
    const steps: QueryStep[] = [];

    const result = await runQuery({ instruction: 'Säljare', template: 'employment' }, deps, {
      onStep: (step) => steps.push(step),
    });

    expect(result.timings.sourcesMs).toBe(result.timings.searchMs + 40);
    expect(steps.find(({ step }) => step === 'search')?.timings.sourcesMs).toBeUndefined();
    expect(steps.find(({ step }) => step === 'rerank')?.timings.sourcesMs).toBe(
      result.timings.sourcesMs,
    );
  });

  it('reports the time to sources at search for a flow without a rerank step', async () => {
    const { deps } = fakeFlow({});
    const steps: QueryStep[] = [];

    const result = await runQuery(
      { instruction: 'Säljare', template: 'employment' },
      { ...deps, translate: undefined, rerank: undefined },
      { onStep: (step) => steps.push(step) },
    );

    expect(result.timings.sourcesMs).toBe(result.timings.searchMs);
    expect(steps.find(({ step }) => step === 'search')?.timings.sourcesMs).toBe(
      result.timings.searchMs,
    );
  });

  it('reports each step as soon as it is done', async () => {
    const { deps } = fakeFlow({ '1': 0.6, '2': 0.9, '3': 0.2 });
    const steps: QueryStep[] = [];

    await runQuery({ instruction: 'Säljare', template: 'employment' }, deps, {
      onStep: (step) => steps.push(step),
    });

    expect(steps.map(({ step }) => step)).toEqual([
      'translation',
      'search',
      'rerank',
      'generation',
    ]);
    expect(steps[0]).toMatchObject({ tags: [{ slug: 'uppsagning', origin: 'translated' }] });
    expect(steps[1]).toMatchObject({ candidates: 3, fallback: 0 });
    expect(steps[2]).toMatchObject({
      candidates: 3,
      judged: true,
      relevant: 2,
      approved: 2,
      timings: { judgingMs: 40 },
    });
  });

  it('asks search, rerank and generator the template’s default instruction without free text', async () => {
    const { deps, calls } = fakeFlow({ '1': 0.6 });
    const asked: string[] = [];
    const translated: string[] = [];

    const result = await runQuery(
      { instruction: '  ', template: 'nda' },
      {
        ...deps,
        translate: async (query) => {
          translated.push(query.instruction);
          return { tags: [], elapsedMs: 0 };
        },
        search: async (instruction, tags) => {
          asked.push(instruction);
          return deps.search(instruction, tags);
        },
      },
    );

    expect(translated).toEqual(['  ']);
    expect(asked).toEqual(['Sekretessavtal']);
    expect(calls.generated).toEqual([['1']]);
    expect(result.defaultInstruction).toBe('Sekretessavtal');
  });

  it('counts the candidates the full-text fallback added', async () => {
    const { deps } = fakeFlow({});

    const result = await runQuery(
      { instruction: 'Säljare', template: 'nda' },
      {
        ...deps,
        search: async () => ({
          candidates: [
            { chunkId: 1, origin: 'tag' as const },
            { chunkId: 2, origin: 'fts' as const },
          ],
        }),
      },
    );

    expect(result.fallback).toBe(1);
    expect(result.defaultInstruction).toBeUndefined();
  });

  it('stops before the next step once the signal is aborted', async () => {
    const { deps, calls } = fakeFlow({ '1': 0.6 });
    const abort = new AbortController();

    const run = runQuery({ instruction: 'Säljare', template: 'nda' }, deps, {
      signal: abort.signal,
      onStep: ({ step }) => {
        if (step === 'search') abort.abort();
      },
    });

    await expect(run).rejects.toThrow();
    expect(calls.judged).toEqual([]);
    expect(calls.generated).toEqual([]);
  });

  it('writes no draft when none is asked for', async () => {
    const { deps, calls } = fakeFlow({ '1': 0.6, '2': 0.9 });

    const result = await runQuery({ instruction: 'Säljare', template: 'nda' }, deps, {
      draft: false,
    });

    expect(calls.generated).toEqual([]);
    expect(result.approved).toHaveLength(2);
    expect(result.draft).toBeUndefined();
  });

  it('stops before generation when nothing is approved', async () => {
    const { deps, calls } = fakeFlow({ '1': 0.1, '2': 0.4 });

    const result = await runQuery({ instruction: 'Säljare', template: 'nda' }, deps);

    expect(calls.generated).toEqual([]);
    expect(result.draft).toBeUndefined();
    expect(result.approved).toEqual([]);
    expect(result.judging).toMatchObject({ unknown: 1 });
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
    expect(result.approved).toHaveLength(3);
    expect(result.judging).toMatchObject({ judgeCalls: 3 });
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

  it('judges with the LLM by default and writes no draft when no candidate reaches JUDGE_THRESHOLD', async () => {
    database = createEvalDatabase();
    const flow = createQueryFlow(
      database.db,
      {
        ...ENV,
        RERANKER: undefined,
        DATABASE_PATH: database.path,
        // The fake judge scores the share of the instruction's words a chunk has; no chunk has "xylofon".
        JUDGE_THRESHOLD: '1',
      },
      logger,
    );
    const steps: QueryStep[] = [];

    const result = await runQuery(
      { instruction: 'Uppsägning ska vara sakligt grundad xylofon', template: 'employment' },
      flow,
      { onStep: (step) => steps.push(step) },
    );

    expect(flow.reranker.name).toBe('llm');
    expect(result.candidates).toBeGreaterThan(0);
    expect(steps.find(({ step }) => step === 'rerank')).toMatchObject({
      candidates: result.candidates,
      judged: true,
      relevant: 0,
      approved: 0,
    });
    expect(result.approved).toEqual([]);
    expect(result.draft).toBeUndefined();
  });

  // The fake judge scores chunk 11 (7 §) 1 and chunk 12 0.25 for this instruction.
  it.each([
    ['0.5', '8', 1, ['11']],
    ['0.2', '1', 2, ['11']],
  ])(
    'with JUDGE_THRESHOLD %s and RERANK_TOP_K %s, keeps the %i chunks at or above it, best first, capped',
    async (threshold, topK, relevant, approved) => {
      database = createEvalDatabase();
      const flow = createQueryFlow(
        database.db,
        { ...ENV, DATABASE_PATH: database.path, JUDGE_THRESHOLD: threshold, RERANK_TOP_K: topK },
        logger,
      );

      const result = await runQuery(
        { instruction: 'Uppsägning ska vara sakligt grundad', template: 'employment' },
        flow,
      );

      expect(result.sources.map(({ chunk, score }) => [chunk.id, score])).toEqual([
        ['11', 1],
        ['12', 0.25],
      ]);
      expect(result.judging?.relevant).toBe(relevant);
      expect(result.approved.map(({ id }) => id)).toEqual(approved);
      expect(result.draft?.used.map(({ id }) => id)).toEqual(approved);
    },
  );

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
    expect(result.draft?.used[0].document).toEqual({ title: 'Lag (1982:80) om anställningsskydd' });
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
    expect(result.timings.translationMs !== undefined).toBe(translated);
    expect(result.timings.embeddingMs !== undefined).toBe(retriever !== 'tags');
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
