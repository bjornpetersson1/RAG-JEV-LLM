import type { DatabaseSync } from 'node:sqlite';
import type { Embedder } from '../embedding/types.js';
import { isRemoteReranker } from '../rerank/factory.js';
import type { Reranker } from '../rerank/types.js';
import { loadSampleChunks } from './passages.js';

const WARM_UP_TEXT = 'uppvärmning';

/**
 * Loads the embedder and every local reranker on one chunk, so nothing timed afterwards pays for a
 * model load. A failure here shows up again in the timed run, so it is ignored.
 */
export async function warmUpLocalModels(
  db: DatabaseSync,
  embedder: Embedder | undefined,
  rerankers: readonly Reranker[],
): Promise<void> {
  if (embedder) await embedder.embed([WARM_UP_TEXT], 'query').catch(() => {});
  const local = rerankers.filter((reranker) => !isRemoteReranker(reranker));
  if (local.length === 0) return;
  const chunks = loadSampleChunks(db, 1);
  for (const reranker of local) await reranker.rerank(WARM_UP_TEXT, chunks, 1).catch(() => {});
}
