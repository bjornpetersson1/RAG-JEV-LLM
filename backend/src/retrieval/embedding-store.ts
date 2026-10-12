// The chunk embeddings in SQLite (E8-4): one dense vector per chunk, keyed by the model, precision
// and a hash of the embedded text, so `index:embed` only embeds what changed.

import type { DatabaseSync } from 'node:sqlite';
import { inTransaction } from '../db/database.js';
import { passageText } from '../models/passages.js';
import { sha256 } from '../text.js';

/** What an embedding was made with; a different model or precision makes it stale. */
export interface EmbeddingIdentity {
  model: string;
  dtype: string;
}

/** A chunk as it is embedded. */
export interface EmbeddingInput {
  chunkId: number;
  /** The heading path and text (`passageText`). */
  text: string;
  textHash: string;
}

/** Every chunk's vector, contiguous, for brute-force search. */
export interface VectorIndex {
  chunkIds: number[];
  dimensions: number;
  /** `chunkIds.length × dimensions` floats; row `i` is chunk `chunkIds[i]`. */
  vectors: Float32Array;
}

interface StoredRow {
  chunk_id: number;
  model: string;
  dtype: string;
  text_hash: string;
}

/** The chunks whose embedding is missing or was made from another text, model or precision. */
export function staleChunks(db: DatabaseSync, identity: EmbeddingIdentity): EmbeddingInput[] {
  const stored = new Map(
    (
      db
        .prepare('SELECT chunk_id, model, dtype, text_hash FROM chunk_embeddings')
        .all() as unknown as StoredRow[]
    ).map((row) => [row.chunk_id, row]),
  );
  return embeddingInputs(db).filter(({ chunkId, textHash }) => {
    const row = stored.get(chunkId);
    return (
      !row ||
      row.model !== identity.model ||
      row.dtype !== identity.dtype ||
      row.text_hash !== textHash
    );
  });
}

/** Stores the vectors, replacing each chunk's previous embedding, in one transaction. */
export function storeEmbeddings(
  db: DatabaseSync,
  identity: EmbeddingIdentity,
  embedded: readonly { input: EmbeddingInput; dense: Float32Array }[],
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, model, dtype, text_hash, dense, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  inTransaction(db, () => {
    for (const { input, dense } of embedded) {
      const bytes = new Uint8Array(dense.buffer, dense.byteOffset, dense.byteLength);
      insert.run(input.chunkId, identity.model, identity.dtype, input.textHash, bytes, now);
    }
  });
}

/**
 * Every chunk's vector, for the embedder `identity`. Throws when any chunk's embedding is missing
 * or stale, naming `npm run index:embed`: search never embeds chunks itself.
 */
export function loadVectorIndex(db: DatabaseSync, identity: EmbeddingIdentity): VectorIndex {
  assertEmbeddingsReady(db, identity);
  const rows = db
    .prepare('SELECT chunk_id, dense FROM chunk_embeddings ORDER BY chunk_id')
    .all() as unknown as { chunk_id: number; dense: Uint8Array }[];
  const dimensions = rows.length > 0 ? rows[0].dense.byteLength / 4 : 0;
  const vectors = new Float32Array(rows.length * dimensions);
  rows.forEach(({ chunk_id, dense }, i) => {
    if (dense.byteLength !== dimensions * 4) {
      throw new Error(
        `Chunk ${chunk_id}'s embedding has ${dense.byteLength / 4} dimensions, not ${dimensions}; ` +
          'run `npm run index:embed`',
      );
    }
    // A copy, since a BLOB's bytes need not be aligned for a Float32Array view.
    vectors.set(new Float32Array(dense.slice().buffer), i * dimensions);
  });
  return { chunkIds: rows.map(({ chunk_id }) => chunk_id), dimensions, vectors };
}

/** Throws, naming `npm run index:embed`, unless every chunk has an up-to-date embedding. */
export function assertEmbeddingsReady(db: DatabaseSync, identity: EmbeddingIdentity): void {
  const migrated = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunk_embeddings'")
    .get();
  if (!migrated) throw new Error('The database has no chunk embeddings; run `npm run index:embed`');
  const stale = staleChunks(db, identity).length;
  if (stale > 0) {
    throw new Error(
      `${stale} chunks have no up-to-date ${identity.model} (${identity.dtype}) embedding; ` +
        'run `npm run index:embed`',
    );
  }
}

function embeddingInputs(db: DatabaseSync): EmbeddingInput[] {
  const rows = db
    .prepare('SELECT id, context, text, source_ref FROM chunks ORDER BY id')
    .all() as unknown as {
    id: number;
    context: string;
    text: string;
    source_ref: string;
  }[];
  return rows.map(({ id, context, text, source_ref }) => {
    const embedded = passageText({ context, text, source: source_ref });
    return { chunkId: id, text: embedded, textHash: sha256(embedded) };
  });
}
