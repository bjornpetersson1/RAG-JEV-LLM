import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, preparedOnce } from '../db/database.js';
import { estimateTokens, type Chunk } from './chunk.js';

export interface StoreCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

interface StoredChunk {
  id: number;
  ordinal: number;
  source_ref: string;
  text: string;
  context: string;
}

const statementsFor = preparedOnce((db) => ({
  select: db.prepare(
    'SELECT id, ordinal, source_ref, text, context FROM chunks WHERE document_id = ?',
  ),
  park: db.prepare('UPDATE chunks SET ordinal = -1 - ordinal WHERE id = ?'),
  insert: db.prepare(
    `INSERT INTO chunks (document_id, ordinal, source_ref, text, context, token_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  update: db.prepare(
    'UPDATE chunks SET ordinal = ?, source_ref = ?, text = ?, context = ?, token_count = ? WHERE id = ?',
  ),
  // A reference that changes hands is parked under a temporary one first, for the unique key.
  parkReference: db.prepare("UPDATE chunks SET source_ref = '#' || id WHERE id = ?"),
  deleteTags: db.prepare('DELETE FROM chunk_tags WHERE chunk_id = ?'),
  delete: db.prepare('DELETE FROM chunks WHERE id = ?'),
}));

/**
 * Pairs each new chunk with the stored chunk it continues: first by source reference, then, among
 * the rest, by identical text and context. The second pass keeps ids and tags when only a reference
 * changed, e.g. when one more sentence turns "del 2/3" into "del 2/4".
 */
function matchStoredChunks(stored: StoredChunk[], chunks: Chunk[]): Map<Chunk, StoredChunk> {
  const matches = new Map<Chunk, StoredChunk>();
  const byReference = new Map(stored.map((chunk) => [chunk.source_ref, chunk]));
  for (const chunk of chunks) {
    const match = byReference.get(chunk.sourceRef);
    if (match) matches.set(chunk, match);
  }
  const used = new Set([...matches.values()]);
  for (const chunk of chunks) {
    if (matches.has(chunk)) continue;
    const match = stored.find(
      (candidate) =>
        !used.has(candidate) &&
        candidate.text === chunk.text &&
        candidate.context === chunk.context,
    );
    if (match) {
      matches.set(chunk, match);
      used.add(match);
    }
  }
  return matches;
}

/**
 * Replaces the document's chunks with `chunks`, matching existing ones by source reference (or,
 * failing that, identical content) so their ids survive. A chunk whose text or context changed keeps its id but loses its tags, which were
 * made from the old content; chunks no longer produced are deleted with their tags. Unchanged
 * chunks in the same place are not written. Runs in one transaction.
 */
export function storeChunks(db: DatabaseSync, documentId: number, chunks: Chunk[]): StoreCounts {
  const statements = statementsFor(db);
  return inTransaction(db, () => {
    const stored = statements.select.all(documentId) as unknown as StoredChunk[];
    const matches = matchStoredChunks(stored, chunks);
    const counts: StoreCounts = { inserted: 0, updated: 0, unchanged: 0, deleted: 0 };

    const kept = new Set([...matches.values()].map((chunk) => chunk.id));
    for (const stale of stored.filter((chunk) => !kept.has(chunk.id))) {
      statements.delete.run(stale.id);
      counts.deleted += 1;
    }
    // Chunks that move are parked on a negative ordinal, and chunks whose reference changes on a
    // temporary one, so renumbering cannot collide with the unique keys.
    chunks.forEach((chunk, ordinal) => {
      const match = matches.get(chunk);
      if (match && match.ordinal !== ordinal) statements.park.run(match.id);
      if (match && match.source_ref !== chunk.sourceRef) statements.parkReference.run(match.id);
    });

    chunks.forEach((chunk, ordinal) => {
      const tokens = estimateTokens(chunk.text);
      const match = matches.get(chunk);
      if (!match) {
        statements.insert.run(
          documentId,
          ordinal,
          chunk.sourceRef,
          chunk.text,
          chunk.context,
          tokens,
        );
        counts.inserted += 1;
        return;
      }
      const changed = match.text !== chunk.text || match.context !== chunk.context;
      if (changed || match.ordinal !== ordinal || match.source_ref !== chunk.sourceRef) {
        statements.update.run(
          ordinal,
          chunk.sourceRef,
          chunk.text,
          chunk.context,
          tokens,
          match.id,
        );
      }
      if (changed) statements.deleteTags.run(match.id);
      counts[changed ? 'updated' : 'unchanged'] += 1;
    });
    return counts;
  });
}
