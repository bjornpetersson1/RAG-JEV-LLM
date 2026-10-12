// The two halves of bge-m3 hybrid search (E8-4) and their fusion: dense cosine similarity over the
// in-memory vectors, SQLite FTS5 BM25 for exact terms such as section numbers, and reciprocal rank
// fusion of any number of rankings.

import type { DatabaseSync } from 'node:sqlite';
import { preparedOnce } from '../db/database.js';
import { citesSource, findFreeTextReferences } from '../legal/references.js';
import { replaceLawAbbreviations } from '../legal/law-names.js';
import type { Candidate } from '../search/candidate-search.js';
import { buildLexicalQuery } from '../search/fts-query.js';
import type { VectorIndex } from './embedding-store.js';

/** The `limit` chunk ids most similar to the unit-length `query`, best first. */
export function denseRanking(index: VectorIndex, query: Float32Array, limit: number): number[] {
  const { chunkIds, dimensions, vectors } = index;
  if (chunkIds.length === 0) return [];
  if (query.length !== dimensions) {
    throw new Error(`Query vector has ${query.length} dimensions; the index has ${dimensions}`);
  }
  const similarity = new Float32Array(chunkIds.length);
  for (let row = 0; row < chunkIds.length; row++) {
    let dot = 0;
    const offset = row * dimensions;
    for (let i = 0; i < dimensions; i++) dot += vectors[offset + i] * query[i];
    similarity[row] = dot;
  }
  return chunkIds
    .map((_, row) => row)
    .sort((a, b) => similarity[b] - similarity[a])
    .slice(0, limit)
    .map((row) => chunkIds[row]);
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
  if (query === null) return [];
  const rows = ftsRanking(db).all(query, limit) as { chunkId: number }[];
  return rows.map(({ chunkId }) => chunkId);
}

/**
 * The chunks of every provision the instruction names, e.g. "7 § LAS" or "2 kap. 9 § DL", in the
 * order it names them. References are found as the post-check (E6-3) finds them; a law named
 * without a section is not a provision and gives none.
 */
export function namedProvisionChunks(db: DatabaseSync, instruction: string): number[] {
  const provisions = findFreeTextReferences(instruction).filter(({ section }) => section);
  if (provisions.length === 0) return [];
  const ids = provisions.flatMap((provision) =>
    (chunksOfDocument(db).all(provision.document) as { id: number; source_ref: string }[])
      .filter(({ source_ref }) => citesSource(provision, source_ref))
      .map(({ id }) => id),
  );
  return [...new Set(ids)];
}

const ftsRanking = preparedOnce((db) =>
  db.prepare(
    'SELECT rowid AS chunkId FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?',
  ),
);

const chunksOfDocument = preparedOnce((db) =>
  db.prepare("SELECT id, source_ref FROM chunks WHERE source_ref LIKE ? || ' %' ORDER BY id"),
);

/**
 * `candidates` with the chunks of the provisions the instruction names first (origin `named`), then
 * the rest without them, at most `limit`. Named chunks take at most half the places, since a
 * section named without its chapter matches that section in every chapter.
 */
export function namedFirst(
  named: readonly number[],
  candidates: readonly Candidate[],
  limit: number,
): Candidate[] {
  const kept = named.slice(0, Math.floor(limit / 2));
  const pinned = new Set(kept);
  return [
    ...kept.map((chunkId) => ({ chunkId, origin: 'named' as const })),
    ...candidates.filter(({ chunkId }) => !pinned.has(chunkId)),
  ].slice(0, limit);
}

/** One ranking to fuse, best first, with the origin it gives a candidate it contributes most to. */
export interface Ranking {
  origin: Candidate['origin'];
  chunkIds: readonly number[];
  weight: number;
}

/**
 * Reciprocal rank fusion: each ranking adds `weight / (k + rank)` (rank from 1) to a chunk's score.
 * The best `limit` chunks, each with the origin of the ranking that gave it the most; equal scores
 * keep the order in which the chunks first appear.
 */
export function fuseRankings(rankings: readonly Ranking[], k: number, limit: number): Candidate[] {
  const fused = new Map<number, { score: number; best: number; origin: Candidate['origin'] }>();
  for (const { origin, chunkIds, weight } of rankings) {
    // A weight of 0 switches a ranking off: its chunks must not fill free places either.
    if (weight <= 0) continue;
    chunkIds.forEach((chunkId, index) => {
      const share = weight / (k + index + 1);
      const entry = fused.get(chunkId);
      if (!entry) fused.set(chunkId, { score: share, best: share, origin });
      else {
        entry.score += share;
        if (share > entry.best) Object.assign(entry, { best: share, origin });
      }
    });
  }
  return [...fused]
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, limit)
    .map(([chunkId, { origin }]) => ({ chunkId, origin }));
}
