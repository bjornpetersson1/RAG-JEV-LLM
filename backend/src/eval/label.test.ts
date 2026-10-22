import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLabelReferenceSearch, formatCandidates, labelCandidates } from './label.js';
import type { EvalQuery } from './queries.js';
import { createEvalDatabase } from './test-helpers.js';

const QUERY: EvalQuery = {
  id: 'anst-03',
  kind: 'employment',
  instruction: 'Sakligt grundad uppsägning, oskälig klausul',
  relevant: [{ document: 'SFS 1982:80', sourceRef: 'SFS 1982:80 11 §', grade: 'central' as const }],
};

describe('labelCandidates', () => {
  let database: ReturnType<typeof createEvalDatabase>;

  beforeEach(() => {
    database = createEvalDatabase();
  });
  afterEach(() => database.remove());

  it('lists tag, full-text and reference hits once each, marked by every search that found them', async () => {
    const deps = {
      translate: async () => ['uppsagning'],
      search: (_query: unknown, _tags: readonly string[], mode: 'tags' | 'fts') =>
        mode === 'tags' ? ['11'] : ['11', '12'],
      // BM25 finds chunk 11 (sakligt grundad) and chunk 21 (oskälig).
      reference: createLabelReferenceSearch(database.db, {
        MAX_CANDIDATES: '2',
        MIN_TAG_CANDIDATES: '1',
      }),
    };

    const listing = await labelCandidates(QUERY, deps, database.db);

    expect(listing).toEqual({
      tags: ['uppsagning'],
      candidates: [
        {
          chunkId: '11',
          document: 'SFS 1982:80',
          sourceRef: 'SFS 1982:80 7 §',
          foundBy: ['tags', 'fts', 'reference'],
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
          foundBy: ['reference'],
          tags: [],
          text: 'Konkurrensklausulen är oskälig.',
          marked: false,
        },
      ],
    });
    expect(formatCandidates(QUERY, listing, 12)).toBe(
      [
        'anst-03 (employment): Sakligt grundad uppsägning, oskälig klausul',
        'Tags: uppsagning',
        '3 candidates (tags 1, fts 2, reference 2; 1 only reference); [x] = already marked relevant',
        '',
        '[ ] #11 tags+fts+reference document: SFS 1982:80 | sourceRef: SFS 1982:80 7 §',
        '    tags: uppsagning',
        '    Uppsägning s',
        '',
        '[x] #12 fts                document: SFS 1982:80 | sourceRef: SFS 1982:80 11 §',
        '    tags: none',
        '    Uppsägningst',
        '',
        '[ ] #21 reference          document: AD 2015 nr 8 | sourceRef: AD 2015 nr 8, Domskäl, del 1/5',
        '    tags: none',
        '    Konkurrenskl',
      ].join('\n'),
    );
  });
});
