import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { parseEvalQueries, resolveEvalQueries } from './queries.js';
import { createEvalDatabase, evalQueries } from './test-helpers.js';

describe('parseEvalQueries', () => {
  it('reads the queries with their template and relevant chunks', () => {
    const text = `
queries:
  - id: anst-01
    kind: employment
    template: employment
    instruction: Anställningsavtal med konkurrensklausul.
    relevant:
      - { document: "AD 2015 nr 8", sourceRef: "AD 2015 nr 8, Domskäl, del 1/5" }
  - id: nda-01
    kind: nda
    instruction: Sekretessavtal.
    relevant: []
`;

    expect(parseEvalQueries(text)).toEqual([
      {
        id: 'anst-01',
        kind: 'employment',
        template: 'employment',
        instruction: 'Anställningsavtal med konkurrensklausul.',
        relevant: [{ document: 'AD 2015 nr 8', sourceRef: 'AD 2015 nr 8, Domskäl, del 1/5' }],
      },
      { id: 'nda-01', kind: 'nda', instruction: 'Sekretessavtal.', relevant: [] },
    ]);
  });

  it('names every malformed query', () => {
    const queries = [
      { id: 'a', kind: 'lease', instruction: 'x', relevant: [] },
      { id: 'b', kind: 'nda', relevant: [] },
      { id: 'c', kind: 'nda', instruction: 'x', template: 'employment', relevant: [] },
      { id: 'd', kind: 'nda', instruction: 'x', relevant: [{ document: 'SFS 1982:80' }] },
      { kind: 'nda', instruction: 'x', relevant: [] },
      { id: 'f', kind: 'nda', instruction: 'x', relevant: [] },
      { id: 'f', kind: 'nda', instruction: 'y', relevant: [] },
    ];

    expect(() => parseEvalQueries(stringify({ queries }))).toThrow(
      [
        'Invalid evaluation set:',
        '  - query a: "kind" must be employment or nda',
        '  - query b: missing "instruction"',
        '  - query c: "template" must be the query\'s kind (nda) when given',
        '  - query d: every relevant chunk needs "document" and "sourceRef"',
        '  - query #5: missing "id"',
        '  - query f: the id is used twice',
      ].join('\n'),
    );
    expect(() => parseEvalQueries('other: 1')).toThrow('needs a "queries" list');
  });
});

describe('resolveEvalQueries', () => {
  let database: ReturnType<typeof createEvalDatabase>;

  beforeEach(() => {
    database = createEvalDatabase();
  });
  afterEach(() => database.remove());

  it('resolves the relevant chunks of a complete set to chunk ids', () => {
    const queries = evalQueries();
    queries[0].relevant.push({
      document: 'AD 2015 nr 8',
      sourceRef: 'AD 2015 nr 8, Domskäl, del 1/5',
    });

    const resolved = resolveEvalQueries(queries, database.db);

    expect(resolved).toHaveLength(20);
    expect([...resolved[0].relevantIds]).toEqual(['11', '21']);
    expect([...resolved[1].relevantIds]).toEqual(['11']);
  });

  it('lists every rule the set breaks and every chunk that does not exist', () => {
    const queries = evalQueries(19).map((query) => ({ ...query, kind: 'nda' as const }));
    queries.forEach((query) => delete query.template);
    queries[0].relevant = [];
    queries[1].relevant = [{ document: 'SFS 1982:80', sourceRef: 'SFS 1982:80 99 §' }];

    expect(() => resolveEvalQueries(queries, database.db)).toThrow(
      [
        'Invalid evaluation set:',
        '  - expected 20 queries, found 19',
        '  - expected at least 8 employment queries, found 0',
        '  - expected at least 4 queries with a template, found 0',
        '  - query q1: no relevant chunk is marked',
        '  - query q2: no chunk "SFS 1982:80 99 §" in SFS 1982:80',
      ].join('\n'),
    );
  });
});
