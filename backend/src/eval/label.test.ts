import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatCandidates, labelCandidates } from './label.js';
import type { EvalQuery } from './queries.js';
import { createEvalDatabase } from './test-helpers.js';

const QUERY: EvalQuery = {
  id: 'anst-03',
  kind: 'employment',
  instruction: 'Uppsägningstid tre månader',
  relevant: [{ document: 'SFS 1982:80', sourceRef: 'SFS 1982:80 11 §', grade: 'central' as const }],
};

describe('labelCandidates', () => {
  let database: ReturnType<typeof createEvalDatabase>;

  beforeEach(() => {
    database = createEvalDatabase();
  });
  afterEach(() => database.remove());

  it('lists tag hits, then full-text hits not already listed, with their tags and marks', async () => {
    const deps = {
      translate: async () => ['uppsagning'],
      search: (_query: unknown, _tags: readonly string[], mode: 'tags' | 'fts') =>
        mode === 'tags' ? ['11'] : ['11', '12'],
    };

    const listing = await labelCandidates(QUERY, deps, database.db);

    expect(listing).toEqual({
      tags: ['uppsagning'],
      candidates: [
        {
          chunkId: '11',
          document: 'SFS 1982:80',
          sourceRef: 'SFS 1982:80 7 §',
          foundBy: 'tags',
          tags: ['uppsagning'],
          text: 'Uppsägning ska vara sakligt grundad.',
          marked: false,
        },
        {
          chunkId: '12',
          document: 'SFS 1982:80',
          sourceRef: 'SFS 1982:80 11 §',
          foundBy: 'fts',
          tags: [],
          text: 'Uppsägningstiden är minst en månad.',
          marked: true,
        },
      ],
    });
    expect(formatCandidates(QUERY, listing, 12)).toBe(
      [
        'anst-03 (employment): Uppsägningstid tre månader',
        'Tags: uppsagning',
        '2 candidates; [x] = already marked relevant',
        '',
        '[ ] #11 tags document: SFS 1982:80 | sourceRef: SFS 1982:80 7 §',
        '    tags: uppsagning',
        '    Uppsägning s',
        '',
        '[x] #12 fts  document: SFS 1982:80 | sourceRef: SFS 1982:80 11 §',
        '    tags: none',
        '    Uppsägningst',
      ].join('\n'),
    );
  });
});
