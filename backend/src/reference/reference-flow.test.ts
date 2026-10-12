import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { runQuery, type QueryFlowDependencies } from '../generation/query-flow.js';
import { NO_USAGE, SILENT_LOGGER } from '../llm/client.js';
import { createFakeGenerator } from '../llm/fakes.js';
import type { Chunk } from '../llm/types.js';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from '../retrieval/test-helpers.js';
import { createDenseSearch } from './dense-search.js';
import { createReferenceFlow } from './setup.js';

const CHUNKS: Record<string, Chunk> = {
  '1': { id: '1', text: 'Ett', source: 'SFS 1982:80 1 §' },
  '2': { id: '2', text: 'Två', source: 'SFS 1982:80 2 §' },
  '3': { id: '3', text: 'Tre', source: 'SFS 1982:80 3 §' },
};

/** The reference RAG's steps over three vectors: chunk 2 lies closest to every query, then 3, then 1. */
function fakeReference(topK: number) {
  const generated: string[][] = [];
  const { embedder, embedded } = createFakeEmbedder(() => [1, 0]);
  const vectorIndex = {
    chunkIds: [1, 2, 3],
    dimensions: 2,
    vectors: Float32Array.from([0, 1, 1, 0, 0.8, 0.6]),
  };
  const deps: QueryFlowDependencies = {
    flow: 'reference',
    search: createDenseSearch(embedder, vectorIndex, topK),
    loadChunks: (ids) => ids.map((id) => CHUNKS[id]),
    generator: createFakeGenerator((input) => {
      generated.push(input.chunks.map((c) => c.id));
      return input.chunks.map((c) => `Klausul [K:${c.id}].`).join('\n');
    }),
    limits: { maxChunks: 20, maxContextChars: 60_000 },
  };
  return { deps, generated, embedded };
}

describe('the reference RAG through runQuery', () => {
  it('embeds the instruction, takes the dense top k and drafts from all of them', async () => {
    const { deps, generated, embedded } = fakeReference(2);

    const result = await runQuery({ instruction: 'Säljare', template: 'employment' }, deps);

    expect(embedded).toEqual(['Säljare']);
    expect(generated).toEqual([['2', '3']]);
    expect(result.flow).toBe('reference');
    expect(result.tags).toEqual([]);
    expect(result.candidates).toBe(2);
    expect(result.approved.map((c) => c.id)).toEqual(['2', '3']);
    expect(result.judging).toBeUndefined();
    expect(result.draft?.check).toMatchObject({ flags: [], references: 2, sourceAccuracy: 1 });
    expect(result.timings.translationMs).toBeUndefined();
    expect(result.timings.judgingMs).toBeUndefined();
    expect(result.timings.searchMs).toBeGreaterThanOrEqual(result.timings.embeddingMs ?? 0);
    expect(result.usage).toEqual({ generation: NO_USAGE });
  });

  it('measures retrieval alone when no draft is asked for', async () => {
    const { deps, generated } = fakeReference(3);

    const result = await runQuery({ instruction: 'Säljare', template: 'nda' }, deps, {
      draft: false,
    });

    expect(generated).toEqual([]);
    expect(result.approved.map((c) => c.id)).toEqual(['2', '3', '1']);
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

  const ENV = { LLM_PROVIDER: 'fake', REFERENCE_TOP_K: '2' };

  it('runs the reference RAG from .env with a fake embedder and fake generator', async () => {
    const { db } = (database = createEvalDatabase());
    const { embedder } = createFakeEmbedder();
    await indexEmbeddings(db, embedder, FAKE_IDENTITY);

    const flow = createReferenceFlow(db, ENV, SILENT_LOGGER, {}, embedder);
    const result = await runQuery(
      { instruction: 'Uppsägning ska vara sakligt grundad', template: 'employment' },
      flow,
    );

    expect(flow.topK).toBe(2);
    expect(result.approved).toHaveLength(2);
    expect(result.draft?.text).toContain('inte juridisk rådgivning');
  });

  it('fails, naming index:embed, before any chunk is embedded', () => {
    const { db } = (database = createEvalDatabase());

    expect(() =>
      createReferenceFlow(db, ENV, SILENT_LOGGER, {}, createFakeEmbedder().embedder),
    ).toThrow('run `npm run index:embed`');
  });
});
