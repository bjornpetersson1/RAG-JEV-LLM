import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { runQuery, type QueryFlowDependencies, type QueryStep } from '../generation/query-flow.js';
import { EMPTY_TAG_INDEX } from '../search/tag-index.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { createFakeGenerator } from '../llm/fakes.js';
import type { Chunk } from '../llm/types.js';
import { fakeRerankResult } from '../rerank/test-helpers.js';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from '../retrieval/test-helpers.js';
import type { RunLogEntry } from '../generation/run-log.js';
import { registerQueryRoute, type QueryEvent, type QueryFlows } from './query-route.js';
import { createQueryFlows } from './setup.js';

const CHUNKS: Record<string, Chunk> = {
  '1': { id: '1', text: 'Ett', source: 'SFS 1982:80 1 §' },
  '2': { id: '2', text: 'Två', source: 'SFS 1982:80 2 §' },
};

/** A flow over two chunks, the second from the full-text fallback; `gate` holds the rerank. */
function fakeFlow(gate: Promise<void> = Promise.resolve()): QueryFlowDependencies {
  return {
    translate: async ({ instruction }) => ({
      tags: [
        { slug: 'anstallningsavtal', origin: 'preset' },
        ...(instruction ? [{ slug: 'provanstallning', origin: 'translated' as const }] : []),
      ],
      elapsedMs: 3,
    }),
    search: async () => ({
      candidates: [
        { chunkId: 1, origin: 'tag' },
        { chunkId: 2, origin: 'fts' },
      ],
    }),
    loadChunks: (ids) => ids.map((id) => CHUNKS[id]),
    async rerank(_instruction, chunks) {
      await gate;
      return fakeRerankResult(chunks, { '1': 0.9, '2': 0.2 });
    },
    generator: createFakeGenerator((input) => `Utkast för: ${input.instruction} [K:1].`),
    limits: { maxChunks: 20, maxContextChars: 60_000 },
  };
}

function flows(main: QueryFlowDependencies, reference?: () => QueryFlowDependencies): QueryFlows {
  return {
    main: () => main,
    reference:
      reference ??
      (() => {
        throw new Error('The database has no chunk embeddings; run `npm run index:embed`');
      }),
  };
}

/** The run log's lines, as the route appends them. */
const logged: RunLogEntry[] = [];

function appWith(queryFlows: QueryFlows) {
  const app = buildApp({ logger: false });
  logged.length = 0;
  registerQueryRoute(app, queryFlows, { append: (entry) => logged.push(entry) });
  return app;
}

function events(payload: string): QueryEvent[] {
  return payload
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as QueryEvent);
}

async function post(app: ReturnType<typeof buildApp>, body: unknown) {
  return app.inject({ method: 'POST', url: '/query', payload: body as object });
}

describe('POST /query', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('streams each step, then the result, for a template with free text', async () => {
    app = appWith(flows(fakeFlow()));

    const response = await post(app, { template: 'employment', instruction: 'Säljare' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    const lines = events(response.payload);
    expect(lines.map((event) => (event.type === 'step' ? event.step : event.type))).toEqual([
      'start',
      'translation',
      'search',
      'rerank',
      'generation',
      'result',
      'done',
    ]);
    expect(lines[0]).toEqual({
      type: 'start',
      flow: 'main',
      steps: ['translation', 'search', 'rerank', 'generation'],
    });
    expect(lines[1]).toMatchObject({
      flow: 'main',
      tags: [
        { slug: 'anstallningsavtal', origin: 'preset' },
        { slug: 'provanstallning', origin: 'translated' },
      ],
    });
    expect(lines[2]).toMatchObject({ candidates: 2, fallback: 1 });
    expect(lines[3]).toMatchObject({ approved: 1 });
    expect(lines[5]).toMatchObject({
      type: 'result',
      result: { draft: { text: expect.stringContaining('Utkast för: Säljare') } },
    });
  });

  it('runs the same flow on the template alone, with its default instruction', async () => {
    app = appWith(flows(fakeFlow()));

    const lines = events((await post(app, { template: 'nda' })).payload);

    expect(lines[1]).toMatchObject({ tags: [{ slug: 'anstallningsavtal', origin: 'preset' }] });
    expect(lines.find((event) => event.type === 'result')).toMatchObject({
      result: {
        defaultInstruction: 'Sekretessavtal',
        draft: { text: expect.stringContaining('Sekretessavtal') },
      },
    });
  });

  it('runs the reference RAG after the main flow when asked', async () => {
    const reference = {
      ...fakeFlow(),
      flow: 'reference' as const,
      translate: undefined,
      rerank: undefined,
    };
    app = appWith(flows(fakeFlow(), () => reference));

    const lines = events((await post(app, { template: 'nda', reference: true })).payload);

    const results = lines.flatMap((event) => (event.type === 'result' ? [event.flow] : []));
    expect(results).toEqual(['main', 'reference']);
    expect(lines.find((event) => event.type === 'start' && event.flow === 'reference')).toEqual({
      type: 'start',
      flow: 'reference',
      steps: ['search', 'generation'],
    });
    expect(lines.at(-1)).toEqual({ type: 'done' });
  });

  it('logs each flow of a request as one line, with a shared run id', async () => {
    const reference = {
      ...fakeFlow(),
      flow: 'reference' as const,
      translate: undefined,
      rerank: undefined,
    };
    app = appWith(flows(fakeFlow(), () => reference));

    await post(app, { template: 'nda', instruction: 'Säljare', reference: true });

    expect(logged.map(({ flow, source }) => `${source} ${flow}`)).toEqual([
      'api main',
      'api reference',
    ]);
    expect(new Set(logged.map(({ runId }) => runId)).size).toBe(1);
    expect(logged[0]).toMatchObject({
      template: 'nda',
      instruction: 'Säljare',
      counts: { tags: 2, candidates: 2, fallback: 1, approved: 1, sent: 1, cited: 1 },
      sourceAccuracy: 1,
    });
  });

  it('logs a run that fails midway with its error and the timings it reached', async () => {
    const failing: QueryFlowDependencies = {
      ...fakeFlow(),
      rerank: () => Promise.reject(new Error('reranker crashed')),
    };
    app = appWith(flows(failing));

    await post(app, { template: 'nda', instruction: 'Säljare' });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ flow: 'main', error: 'reranker crashed' });
    expect(logged[0].timings).toMatchObject({ translationMs: 3, searchMs: expect.any(Number) });
    expect(logged[0].timings.judgingMs).toBeUndefined();
    expect(logged[0].counts).toBeUndefined();
  });

  it('skips a flow that cannot be built, keeping the main flow’s result', async () => {
    app = appWith(flows(fakeFlow()));

    const lines = events((await post(app, { template: 'nda', reference: true })).payload);

    expect(lines.slice(-3).map(({ type }) => type)).toEqual(['result', 'skipped', 'done']);
    expect(lines.at(-2)).toEqual({
      type: 'skipped',
      flow: 'reference',
      reason: 'The database has no chunk embeddings; run `npm run index:embed`',
    });
  });

  it('ends the stream with an error event when a flow fails while running', async () => {
    const failing = { ...fakeFlow(), rerank: () => Promise.reject(new Error('reranker crashed')) };
    app = appWith(flows(failing));

    const lines = events((await post(app, { template: 'nda', reference: true })).payload);

    expect(lines.at(-1)).toEqual({ type: 'error', flow: 'main', message: 'reranker crashed' });
  });

  it.each([
    ['no template', { instruction: 'Säljare' }, '"template" must be employment or nda'],
    ['an unknown template', { template: 'lease' }, '"template" must be employment or nda'],
    [
      'a non-string instruction',
      { template: 'nda', instruction: 4 },
      '"instruction" must be a string',
    ],
    [
      'a non-boolean reference',
      { template: 'nda', reference: 'yes' },
      '"reference" must be true or false',
    ],
  ])('answers 400 for %s', async (_case, body, error) => {
    app = appWith(flows(fakeFlow()));

    const response = await post(app, body);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });

  it('answers 409 while a query is running, and runs again once it is done', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    app = appWith(flows(fakeFlow(gate)));

    const first = post(app, { template: 'nda' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await post(app, { template: 'nda' });
    release();

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'A query is already running' });
    expect((await first).statusCode).toBe(200);
    expect((await post(app, { template: 'nda' })).statusCode).toBe(200);
  });
});

describe('createQueryFlows', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    database?.remove();
    database = app = undefined;
  });

  const ENV = {
    LLM_PROVIDER: 'fake',
    QUERY_TRANSLATOR_IMPL: 'llm',
    RERANKER: 'llm',
    JUDGE_CACHE: 'off',
  };

  // The fake judge approves by shared words, so the default instruction approves nothing here and the
  // main flow writes no draft; the reference RAG has no judge and always drafts.
  it.each([
    ['the template alone', { template: 'employment' }, ['reference']],
    [
      'the template and free text',
      { template: 'employment', instruction: 'Uppsägning ska vara sakligt grundad' },
      ['main', 'reference'],
    ],
  ])('runs both flows from %s through the route, with fake roles', async (_case, body, drafted) => {
    const { db, path } = (database = createEvalDatabase());
    const { embedder } = createFakeEmbedder();
    await indexEmbeddings(db, embedder, FAKE_IDENTITY);
    app = appWith(
      createQueryFlows(db, { ...ENV, DATABASE_PATH: path }, SILENT_LOGGER, { retrieval: embedder }),
    );

    const lines = events((await post(app, { ...body, reference: true })).payload);

    const results = lines.flatMap((event) => (event.type === 'result' ? [event] : []));
    expect(results.map(({ flow }) => flow)).toEqual(['main', 'reference']);
    expect(results.filter(({ result }) => result.draft).map(({ flow }) => flow)).toEqual(drafted);
    expect(lines.at(-1)).toEqual({ type: 'done' });
  });
});

describe('a client that goes away', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('stops the query before its next step and frees the server', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const flow = fakeFlow(gate);
    const generate = vi.spyOn(flow.generator, 'generate');
    app = appWith(flows(flow));
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    // A local socket, not `fetch`, which the test setup blocks.
    const client = request(`${address}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const firstLine = new Promise((resolve) =>
      client.on('response', (response) => response.once('data', resolve)),
    );
    client.end(JSON.stringify({ template: 'nda', instruction: 'Säljare' }));
    await firstLine;
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(generate).not.toHaveBeenCalled();
    const next = await app.inject({ method: 'POST', url: '/query', payload: { template: 'nda' } });
    expect(next.statusCode).toBe(200);
  });
});

describe('createQueryFlows on the server', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('fails, naming index:embed, when RETRIEVER=bge has no embeddings', () => {
    const { db, path } = (database = createEvalDatabase());

    expect(() =>
      createQueryFlows(
        db,
        { LLM_PROVIDER: 'fake', RETRIEVER: 'bge', DATABASE_PATH: path },
        SILENT_LOGGER,
        { retrieval: createFakeEmbedder().embedder },
      ),
    ).toThrow('run `npm run index:embed`');
  });

  it('warms up without the reference RAG’s embeddings, and with them', async () => {
    const { db, path } = (database = createEvalDatabase());
    const { embedder, embedded } = createFakeEmbedder();
    const env = { LLM_PROVIDER: 'fake', RERANKER: 'llm', DATABASE_PATH: path };

    await createQueryFlows(db, env, SILENT_LOGGER, { retrieval: embedder }).warmUp?.();
    expect(embedded).toEqual([]);

    await indexEmbeddings(db, embedder, FAKE_IDENTITY);
    const indexed = embedded.length;
    await createQueryFlows(db, env, SILENT_LOGGER, { retrieval: embedder }).warmUp?.();
    expect(embedded.slice(indexed)).toEqual(['uppvärmning']);
  });

  it('searches with the tag index it is given', async () => {
    const { db, path } = (database = createEvalDatabase());
    const queryFlows = createQueryFlows(
      db,
      { LLM_PROVIDER: 'fake', RERANKER: 'llm', JUDGE_CACHE: 'off', DATABASE_PATH: path },
      SILENT_LOGGER,
      { tagIndex: EMPTY_TAG_INDEX },
    );
    const steps: QueryStep[] = [];

    await runQuery({ template: 'employment', instruction: 'Uppsägning' }, queryFlows.main(), {
      onStep: (step) => steps.push(step),
    });

    // With an empty tag index every candidate comes from the full-text fallback.
    const search = steps.find((step) => step.step === 'search');
    expect(search).toMatchObject({
      fallback: search && 'candidates' in search ? search.candidates : -1,
    });
  });
});
