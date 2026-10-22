import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { lexicalQuery, lexicalRanking } from './lexical-search.js';

const TARGET = 11; // SFS 1982:80 7 § in the evaluation database

describe('lexicalQuery', () => {
  it('keeps section numbers and turns a law abbreviation into its SFS number', () => {
    expect(lexicalQuery('7 § LAS')).toBe('"7" OR "1982" OR "80"');
  });

  it('is null without any term', () => {
    expect(lexicalQuery('§ och')).toBeNull();
  });
});

describe('lexicalRanking', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('ranks the chunk sharing more of the query words above one sharing fewer', () => {
    database = createEvalDatabase();

    // Chunk 11 has "sakligt" and "grundad", chunk 21 only "oskälig"; chunk 12 has none of them.
    expect(lexicalRanking(database.db, lexicalQuery('sakligt grundad oskälig'), 10)).toEqual([
      TARGET,
      21,
    ]);
  });

  it('gives no chunks for no query', () => {
    database = createEvalDatabase();

    expect(lexicalRanking(database.db, null, 10)).toEqual([]);
  });
});
