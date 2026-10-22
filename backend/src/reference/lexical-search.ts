// The reference RAG's retrieval (E5-4, E10-1): the chunks SQLite FTS5 ranks best (BM25) for the
// instruction. No tags; the judge comes after (E7-9).

import type { DatabaseSync } from 'node:sqlite';
import type { QueryFlowDependencies } from '../generation/query-flow.js';
import { replaceLawAbbreviations } from '../legal/law-names.js';
import { bm25Ranking } from '../search/candidate-search.js';
import { buildLexicalQuery } from '../search/fts-query.js';

/** The `topK` chunks BM25 ranks best for the instruction. */
export function createLexicalSearch(
  db: DatabaseSync,
  topK: number,
): QueryFlowDependencies['search'] {
  return async (instruction) => ({
    candidates: lexicalRanking(db, lexicalQuery(instruction), topK).map((chunkId) => ({
      chunkId,
      origin: 'lexical' as const,
    })),
  });
}

/**
 * The lexical query for an instruction: law abbreviations become their SFS number, since
 * `source_ref` holds `SFS 1982:80 7 §`, and numbers are kept whatever their length.
 */
export function lexicalQuery(instruction: string): string | null {
  return buildLexicalQuery(replaceLawAbbreviations(instruction, (_written, sfs) => sfs));
}

/** The `limit` chunk ids FTS5 ranks best (BM25) for `query`, best first; none for no query. */
export function lexicalRanking(db: DatabaseSync, query: string | null, limit: number): number[] {
  return query === null ? [] : bm25Ranking(db, query, limit);
}
