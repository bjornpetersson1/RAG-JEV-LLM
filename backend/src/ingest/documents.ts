import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, preparedOnce } from '../db/database.js';
import type { DocumentStructure } from './structure.js';

export interface DocumentRow {
  title: string;
  identifier: string;
  court: string | null;
  date: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  rawText: string;
  /** Also decides `documents.type`, so the two cannot disagree. */
  structure: DocumentStructure;
  consolidatedThrough: string | null;
}

/**
 * Inserts the document, or updates the row with the same identifier in place so its id (and the
 * chunks and tags that reference it) are kept. Runs in its own transaction.
 */
export function upsertDocument(db: DatabaseSync, row: DocumentRow): 'inserted' | 'updated' {
  const { exists, upsert } = statementsFor(db);
  return inTransaction(db, () => {
    const outcome = exists.get(row.identifier) ? 'updated' : 'inserted';
    upsert.run({ ...row, type: row.structure.kind, structure: JSON.stringify(row.structure) });
    return outcome;
  });
}

/** Prepared once per connection, since an import upserts every document through them. */
const statementsFor = preparedOnce(prepareStatements);

function prepareStatements(db: DatabaseSync) {
  return {
    exists: db.prepare('SELECT 1 FROM documents WHERE identifier = ?'),
    upsert: db.prepare(
      `INSERT INTO documents
         (type, title, identifier, court, date, source_url, fetched_at, raw_text, structure,
          consolidated_through)
       VALUES (:type, :title, :identifier, :court, :date, :sourceUrl, :fetchedAt, :rawText,
               :structure, :consolidatedThrough)
       ON CONFLICT (identifier) DO UPDATE SET
         type = excluded.type,
         title = excluded.title,
         court = excluded.court,
         date = excluded.date,
         source_url = excluded.source_url,
         fetched_at = excluded.fetched_at,
         raw_text = excluded.raw_text,
         structure = excluded.structure,
         consolidated_through = excluded.consolidated_through`,
    ),
  };
}
