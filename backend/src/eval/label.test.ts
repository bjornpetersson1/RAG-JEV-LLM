import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from '../retrieval/test-helpers.js';
import { createLabelDenseSearch, formatCandidates, labelCandidates } from './label.js';
import type { EvalQuery } from './queries.js';
import { createEvalDatabase } from './test-helpers.js';

const QUERY: EvalQuery = {
  id: 'anst-03',
  kind: 'employment',
  instruction: 'Uppsägningstid tre månader',
  relevant: [{ document: 'SFS 1982:80', sourceRef: 'SFS 1982:80 11 §', grade: 'central' as const }],
};

/** The instruction and the ruling point one way, chunk 11 nearly so and chunk 12 the other way. */
function vectorFor(text: string): number[] {
  if (text === QUERY.instruction || text.includes('Konkurrens')) return [1, 0];
  if (text.includes('sakligt')) return [0.8, 0.6];
  return [0, 1];
}

describe('labelCandidates', () => {
  let database: ReturnType<typeof createEvalDatabase>;

  beforeEach(() => {
    database = createEvalDatabase();
  });
  afterEach(() => database.remove());

  it('lists tag, full-text and dense hits once each, marked by every search that found them', async () => {
    const { embedder, embedded } = createFakeEmbedder(vectorFor);
    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    const deps = {
      translate: async () => ['uppsagning'],
      search: (_query: unknown, _tags: readonly string[], mode: 'tags' | 'fts') =>
        mode === 'tags' ? ['11'] : ['11', '12'],
      dense: createLabelDenseSearch(
        database.db,
        { MAX_CANDIDATES: '2', MIN_TAG_CANDIDATES: '1' },
        embedder,
      ),
    };

    const listing = await labelCandidates(QUERY, deps, database.db);

    expect(embedded.at(-1)).toBe(QUERY.instruction);
    expect(listing).toEqual({
      tags: ['uppsagning'],
      candidates: [
        {
          chunkId: '11',
          document: 'SFS 1982:80',
          sourceRef: 'SFS 1982:80 7 §',
          foundBy: ['tags', 'fts', 'dense'],
          tags: ['uppsagning'],
          text: 'Uppsägning ska vara sakligt grundad.',
          marked: false,
        },
        {
          chunkId: '12',
          document: 'SFS 1982:80',
          sourceRef: 'SFS 1982:80 11 §',
          foundBy: ['fts'],
          tags: [],
          text: 'Uppsägningstiden är minst en månad.',
          marked: true,
        },
        {
          chunkId: '21',
          document: 'AD 2015 nr 8',
          sourceRef: 'AD 2015 nr 8, Domskäl, del 1/5',
          foundBy: ['dense'],
          tags: [],
          text: 'Konkurrensklausulen är oskälig.',
          marked: false,
        },
      ],
    });
    expect(formatCandidates(QUERY, listing, 12)).toBe(
      [
        'anst-03 (employment): Uppsägningstid tre månader',
        'Tags: uppsagning',
        '3 candidates (tags 1, fts 2, dense 2; 1 only dense); [x] = already marked relevant',
        '',
        '[ ] #11 tags+fts+dense document: SFS 1982:80 | sourceRef: SFS 1982:80 7 §',
        '    tags: uppsagning',
        '    Uppsägning s',
        '',
        '[x] #12 fts            document: SFS 1982:80 | sourceRef: SFS 1982:80 11 §',
        '    tags: none',
        '    Uppsägningst',
        '',
        '[ ] #21 dense          document: AD 2015 nr 8 | sourceRef: AD 2015 nr 8, Domskäl, del 1/5',
        '    tags: none',
        '    Konkurrenskl',
      ].join('\n'),
    );
  });

  it('fails naming index:embed when the chunks are not embedded with the embedder', () => {
    expect(() =>
      createLabelDenseSearch(database.db, {}, createFakeEmbedder(vectorFor).embedder),
    ).toThrow('index:embed');
  });
});
