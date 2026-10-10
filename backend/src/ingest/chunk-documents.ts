import type { DatabaseSync } from 'node:sqlite';
import { chunkDocument } from './chunk.js';
import type { ChunkConfig } from './chunk-config.js';
import { storeChunks, type StoreCounts } from './chunk-store.js';
import { forEachDocument, type Failure } from './failures.js';
import type { DocumentStructure } from './structure.js';

export interface ChunkDocumentsOptions {
  db: DatabaseSync;
  config: ChunkConfig;
  /** Chunk only this document; every document when unset. */
  identifier?: string;
  log?: (message: string) => void;
}

export interface ChunkDocumentsResult extends StoreCounts {
  /** Characters of every chunk's text, for the summary. */
  lengths: number[];
  failed: Failure[];
}

interface DocumentRecord {
  id: number;
  identifier: string;
  title: string;
}

/**
 * Chunks every document (or one) and stores the chunks, logging one line per document. A document
 * that fails keeps its previous chunks and the rest are still chunked.
 */
export function chunkDocuments(options: ChunkDocumentsOptions): ChunkDocumentsResult {
  const { db, config, identifier } = options;
  const log = options.log ?? console.log;
  const documents = (identifier === undefined
    ? db.prepare('SELECT id, identifier, title, structure FROM documents ORDER BY id').all()
    : db
        .prepare('SELECT id, identifier, title, structure FROM documents WHERE identifier = ?')
        .all(identifier)) as unknown as DocumentRecord[];
  const selectStructure = db.prepare('SELECT structure FROM documents WHERE id = ?');
  if (identifier !== undefined && documents.length === 0) {
    throw new Error(`No document with identifier ${identifier}`);
  }

  const result: ChunkDocumentsResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    lengths: [],
    failed: [],
  };
  result.failed = forEachDocument(
    documents,
    (document) => document.identifier,
    (document) => {
      // Loaded one document at a time, so only one structure tree is in memory.
      const { structure: json } = selectStructure.get(document.id) as { structure: string | null };
      if (json === null) throw new Error('No structure; import the document again');
      const structure = JSON.parse(json) as DocumentStructure;
      const chunks = chunkDocument({ ...document, structure }, config);
      const counts = storeChunks(db, document.id, chunks);
      for (const key of ['inserted', 'updated', 'unchanged', 'deleted'] as const) {
        result[key] += counts[key];
      }
      const lengths = chunks.map((chunk) => chunk.text.length);
      result.lengths.push(...lengths);
      log(`${document.identifier}: ${chunks.length} chunks, ${describeLengths(lengths)}`);
    },
    log,
  );
  return result;
}

/** "min/median/max 120/850/2000 characters". */
export function describeLengths(lengths: number[]): string {
  if (lengths.length === 0) return 'no text';
  const sorted = [...lengths].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted.at(middle) ?? 0;
  const median =
    sorted.length % 2 === 1 ? upper : Math.round(((sorted.at(middle - 1) ?? 0) + upper) / 2);
  return `min/median/max ${sorted.at(0)}/${median}/${sorted.at(-1)} characters`;
}
