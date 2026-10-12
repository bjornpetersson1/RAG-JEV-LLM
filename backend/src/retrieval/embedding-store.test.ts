import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { loadVectorIndex, staleChunks } from './embedding-store.js';
import { indexEmbeddings } from './index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from './test-helpers.js';

describe('indexEmbeddings', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('embeds every chunk once; a second run embeds nothing', async () => {
    database = createEvalDatabase();
    const { embedder, embedded } = createFakeEmbedder();

    const first = await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    const second = await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);

    expect(first).toEqual({ embedded: 3, upToDate: 0 });
    expect(second).toEqual({ embedded: 0, upToDate: 3 });
    expect(embedded).toHaveLength(3);
  });

  it('embeds the heading path and text, or the source and text without one, shortest first', async () => {
    database = createEvalDatabase();
    database.db.exec("UPDATE chunks SET context = 'LAS › 7 §' WHERE id = 11");
    const { embedder, embedded } = createFakeEmbedder();

    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);

    expect(embedded).toEqual([
      'LAS › 7 §\nUppsägning ska vara sakligt grundad.',
      'SFS 1982:80 11 §\n\nUppsägningstiden är minst en månad.',
      'AD 2015 nr 8, Domskäl, del 1/5\n\nKonkurrensklausulen är oskälig.',
    ]);
  });

  it('re-embeds only a chunk whose text changed, and every chunk for another precision', async () => {
    database = createEvalDatabase();
    const { embedder, embedded } = createFakeEmbedder();
    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);

    database.db.exec("UPDATE chunks SET text = 'Ny text.' WHERE id = 12");
    const changed = await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    const fp32 = await indexEmbeddings(database.db, embedder, { ...FAKE_IDENTITY, dtype: 'fp32' });

    expect(changed.embedded).toBe(1);
    expect(fp32.embedded).toBe(3);
    expect(embedded.slice(3, 4)).toEqual(['SFS 1982:80 11 §\n\nNy text.']);
  });

  it('reports progress per stored round', async () => {
    database = createEvalDatabase();
    const progress: [number, number][] = [];

    await indexEmbeddings(
      database.db,
      createFakeEmbedder().embedder,
      FAKE_IDENTITY,
      (done, total) => progress.push([done, total]),
    );

    expect(progress).toEqual([[3, 3]]);
  });
});

describe('loadVectorIndex', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('loads every vector, contiguous, in chunk id order', async () => {
    database = createEvalDatabase();
    await indexEmbeddings(database.db, createFakeEmbedder().embedder, FAKE_IDENTITY);

    const index = loadVectorIndex(database.db, FAKE_IDENTITY);

    expect(index.chunkIds).toEqual([11, 12, 21]);
    expect(index.dimensions).toBe(6);
    expect(index.vectors).toHaveLength(18);
    expect(Math.hypot(...index.vectors.slice(0, 6))).toBeCloseTo(1, 6);
  });

  it('fails, naming index:embed, when embeddings are missing or stale', async () => {
    database = createEvalDatabase();
    expect(() => loadVectorIndex(database!.db, FAKE_IDENTITY)).toThrow(
      '3 chunks have no up-to-date fake-embedder (int8) embedding; run `npm run index:embed`',
    );

    await indexEmbeddings(database.db, createFakeEmbedder().embedder, FAKE_IDENTITY);
    database.db.exec("UPDATE chunks SET text = 'Ny text.' WHERE id = 12");

    expect(staleChunks(database.db, FAKE_IDENTITY).map(({ chunkId }) => chunkId)).toEqual([12]);
    expect(() => loadVectorIndex(database!.db, FAKE_IDENTITY)).toThrow('run `npm run index:embed`');
  });

  it('fails on a stored vector of the wrong length', async () => {
    database = createEvalDatabase();
    await indexEmbeddings(database.db, createFakeEmbedder().embedder, FAKE_IDENTITY);
    database.db.exec('UPDATE chunk_embeddings SET dense = zeroblob(8) WHERE chunk_id = 21');

    expect(() => loadVectorIndex(database!.db, FAKE_IDENTITY)).toThrow(
      "Chunk 21's embedding has 2 dimensions, not 6",
    );
  });
});
