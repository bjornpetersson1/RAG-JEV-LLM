import { createTestDatabase } from '../db/test-helpers.js';
import { storeChunks } from '../ingest/chunk-store.js';
import { upsertDocument } from '../ingest/documents.js';
import { FETCHED_AT } from '../ingest/test-helpers.js';

/** A temporary migrated database with a helper to add a document's chunks. */
export function createTaggingWorkspace() {
  const { db, path, remove } = createTestDatabase('tagging-');

  return {
    db,
    path,
    /** Adds a law with one chunk per text and returns the chunk ids in order. */
    addChunks(identifier: string, texts: string[]): number[] {
      upsertDocument(db, {
        title: `Lag ${identifier}`,
        identifier,
        court: null,
        date: null,
        sourceUrl: null,
        fetchedAt: FETCHED_AT,
        rawText: '',
        structure: { kind: 'law', chapters: [], transitional: [] },
        consolidatedThrough: null,
      });
      const { id: documentId } = db
        .prepare('SELECT id FROM documents WHERE identifier = ?')
        .get(identifier) as { id: number };
      storeChunks(
        db,
        documentId,
        texts.map((text, index) => ({
          sourceRef: `${identifier} ${index + 1} §`,
          context: `Lag ${identifier}`,
          text,
        })),
      );
      return (
        db
          .prepare('SELECT id FROM chunks WHERE document_id = ? ORDER BY ordinal')
          .all(documentId) as { id: number }[]
      ).map((row) => row.id);
    },
    /** Links the chunk to the stored tag with `slug`. */
    linkTag(chunkId: number, slug: string): void {
      db.prepare(
        `INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at)
         SELECT ?, id, 'fake', 'v1', '2026-10-10T08:00:00.000Z' FROM tags WHERE slug = ?`,
      ).run(chunkId, slug);
    },
    remove,
  };
}
