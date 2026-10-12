import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { createCandidateSearch } from '../search/candidate-search.js';
import { EMPTY_TAG_INDEX } from '../search/tag-index.js';
import { loadRetrievalConfig } from './config.js';
import { loadVectorIndex } from './embedding-store.js';
import {
  denseRanking,
  fuseRankings,
  lexicalQuery,
  lexicalRanking,
  namedFirst,
  namedProvisionChunks,
} from './hybrid.js';
import { indexEmbeddings } from './index-embeddings.js';
import { createRetriever } from './retriever.js';
import { createFakeEmbedder, FAKE_IDENTITY } from './test-helpers.js';

const TARGET = 11; // SFS 1982:80 7 § in the evaluation database

describe('lexicalQuery', () => {
  it('keeps section numbers and turns a law abbreviation into its SFS number', () => {
    expect(lexicalQuery('7 § LAS')).toBe('"7" OR "1982" OR "80"');
  });

  it('is null without any term', () => {
    expect(lexicalQuery('§ och')).toBeNull();
  });
});

describe('fuseRankings', () => {
  it('adds weight / (k + rank) per ranking and keeps the best limit', () => {
    const fused = fuseRankings(
      [
        { origin: 'dense', chunkIds: [1, 2, 3], weight: 1 },
        { origin: 'lexical', chunkIds: [3, 4], weight: 1 },
      ],
      60,
      3,
    );

    // 3: 1/63 + 1/61; 1: 1/61; 2: 1/62; 4: 1/62 (equal to 2, which came first).
    expect(fused).toEqual([
      { chunkId: 3, origin: 'lexical' },
      { chunkId: 1, origin: 'dense' },
      { chunkId: 2, origin: 'dense' },
    ]);
  });

  it('lets a weight of 0 switch a ranking off, also for free places', () => {
    const fused = fuseRankings(
      [
        { origin: 'dense', chunkIds: [1, 3], weight: 0 },
        { origin: 'lexical', chunkIds: [2], weight: 1 },
      ],
      60,
      3,
    );

    expect(fused).toEqual([{ chunkId: 2, origin: 'lexical' }]);
  });
});

describe('namedFirst', () => {
  it('puts named chunks first, without repeating them, in at most half the places', () => {
    const candidates = [1, 2, 3, 4].map((chunkId) => ({ chunkId, origin: 'dense' as const }));

    expect(namedFirst([9, 2, 8], candidates, 4)).toEqual([
      { chunkId: 9, origin: 'named' },
      { chunkId: 2, origin: 'named' },
      { chunkId: 1, origin: 'dense' },
      { chunkId: 3, origin: 'dense' },
    ]);
  });
});

describe('denseRanking', () => {
  it('gives no chunks for an empty index', () => {
    expect(
      denseRanking(
        { chunkIds: [], dimensions: 0, vectors: new Float32Array() },
        new Float32Array(4),
        5,
      ),
    ).toEqual([]);
  });
});

describe('hybrid retrieval', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  /** The evaluation database plus 12 unrelated chunks without numbers: 15 chunks in all. */
  function databaseWithFillers() {
    const created = createEvalDatabase();
    const fillers = Array.from(
      { length: 12 },
      (_, i) =>
        `(${100 + i}, 2, ${10 + i}, 'AD 2015 nr 8, Domskäl, del ${'abcdefghijkl'[i]}', ` +
        `'Allmänt resonemang om lojalitet ${'abcdefghijkl'[i]}.', '', 10)`,
    );
    created.db.exec(
      `INSERT INTO chunks (id, document_id, ordinal, source_ref, text, context, token_count) VALUES ${fillers.join(', ')}`,
    );
    return created;
  }

  /** Bge retrieval of 10 candidates where the target is the chunk least like any query. */
  async function bgeMissingTarget() {
    database = databaseWithFillers();
    const { embedder } = createFakeEmbedder((text) =>
      text.includes('Uppsägning ska vara')
        ? [0, 1]
        : text.includes('§') || text.includes('grundad')
          ? [1, 0]
          : [1, 0.5],
    );
    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    const vectorIndex = loadVectorIndex(database.db, FAKE_IDENTITY);
    const retriever = createRetriever(
      loadRetrievalConfig({ RETRIEVER: 'bge', RETRIEVE_CANDIDATES: '10' }),
      { db: database.db, candidateSearch: candidateSearch(database.db), embedder, vectorIndex },
    );
    return { db: database.db, embedder, vectorIndex, retriever };
  }

  it('brings in through BM25 a chunk the dense half misses', async () => {
    const { db, embedder, vectorIndex, retriever } = await bgeMissingTarget();
    const [query] = await embedder.embed(['sakligt grundad'], 'query');

    expect(denseRanking(vectorIndex, query.dense, 10)).not.toContain(TARGET);
    expect(lexicalRanking(db, lexicalQuery('sakligt grundad'), 10)).toEqual([TARGET]);

    const { candidates } = await retriever.retrieve('sakligt grundad', []);

    expect(candidates).toHaveLength(10);
    expect(candidates).toContainEqual({ chunkId: TARGET, origin: 'lexical' });
  });

  it('puts the chunks of a provision the instruction names first', async () => {
    const { db, embedder, vectorIndex, retriever } = await bgeMissingTarget();
    const [query] = await embedder.embed(['7 § LAS'], 'query');
    expect(denseRanking(vectorIndex, query.dense, 10)).not.toContain(TARGET);

    const { candidates } = await retriever.retrieve('7 § LAS', []);

    expect(candidates).toHaveLength(10);
    expect(candidates[0]).toEqual({ chunkId: TARGET, origin: 'named' });
    expect(namedProvisionChunks(db, 'Uppsägning enligt LAS')).toEqual([]);
    expect(namedProvisionChunks(db, '11 § lagen (1982:80) och 7 § LAS')).toEqual([12, 11]);
  });

  it('fuses the tag ranking in for both', async () => {
    database = createEvalDatabase();
    const { embedder } = createFakeEmbedder();
    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    // Tags weigh most, so the tag hit owes its place to the tag ranking.
    const config = loadRetrievalConfig({
      RETRIEVER: 'both',
      RRF_WEIGHT_DENSE: '0.5',
      RRF_WEIGHT_LEXICAL: '0.5',
    });
    const retriever = createRetriever(config, {
      db: database.db,
      candidateSearch: candidateSearch(database.db, [{ chunkId: 21 }]),
      embedder,
      vectorIndex: loadVectorIndex(database.db, FAKE_IDENTITY),
    });

    const { candidates } = await retriever.retrieve('Konkurrensklausul', ['konkurrensklausul']);

    expect(retriever.usesTags).toBe(true);
    expect(candidates[0]).toEqual({ chunkId: 21, origin: 'tag' });
  });

  it('needs no tags for bge and requires the embedder and vectors', () => {
    database = createEvalDatabase();
    const config = loadRetrievalConfig({ RETRIEVER: 'bge' });

    expect(() =>
      createRetriever(config, { db: database!.db, candidateSearch: candidateSearch(database!.db) }),
    ).toThrow('RETRIEVER=bge needs the embedder and the vector index');
  });
});

/** Candidate search over the database with a tag index that returns `tagHits`. */
function candidateSearch(
  db: ReturnType<typeof createEvalDatabase>['db'],
  tagHits: { chunkId: number }[] = [],
) {
  return createCandidateSearch({
    db,
    tagIndex: {
      ...EMPTY_TAG_INDEX,
      searchRanked: () => tagHits.map(({ chunkId }) => ({ chunkId, matches: 1 })),
    },
    config: { minTagCandidates: 10, maxCandidates: 30 },
    logger: { info() {} },
  });
}
