import type { DatabaseSync } from 'node:sqlite';
import { countRows } from '../db/database.js';
import type { Embedder } from '../embedding/types.js';
import { inBatches } from '../models/runtime.js';
import { staleChunks, storeEmbeddings, type EmbeddingIdentity } from './embedding-store.js';

/** Chunks embedded and stored per round, so an interrupted run keeps what it finished. */
const STORE_EVERY = 32;

export interface IndexResult {
  embedded: number;
  upToDate: number;
}

/**
 * Embeds every chunk whose embedding is missing or stale with `embedder`, shortest first so each
 * batch pads little, and stores the vectors as it goes. A second run with nothing changed embeds
 * nothing.
 */
export async function indexEmbeddings(
  db: DatabaseSync,
  embedder: Embedder,
  identity: EmbeddingIdentity,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<IndexResult> {
  const total = countRows(db, 'SELECT COUNT(*) AS n FROM chunks');
  const stale = staleChunks(db, identity).sort((a, b) => a.text.length - b.text.length);
  let done = 0;
  for (const round of inBatches(stale, STORE_EVERY)) {
    const vectors = await embedder.embed(
      round.map(({ text }) => text),
      'passage',
    );
    storeEmbeddings(
      db,
      identity,
      round.map((input, i) => ({ input, dense: vectors[i].dense })),
    );
    done += round.length;
    onProgress(done, stale.length);
  }
  return { embedded: stale.length, upToDate: total - stale.length };
}
