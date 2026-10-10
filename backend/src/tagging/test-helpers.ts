import { createTestDatabase } from '../db/test-helpers.js';
import { storeChunks } from '../ingest/chunk-store.js';
import { upsertDocument } from '../ingest/documents.js';
import { FETCHED_AT } from '../ingest/test-helpers.js';

/** A temporary migrated database with a helper to add a document's chunks. */
export function createTaggingWorkspace() {
  const { db, remove } = createTestDatabase('tagging-');

  return {
    db,
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
    remove,
  };
}
