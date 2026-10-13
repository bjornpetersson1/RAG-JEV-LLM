// The reference RAG's retrieval (E5-4): embed the instruction and take the chunks most similar to
// it by cosine similarity over E8-4's vectors. No tags or lexical half; the judge comes after (E7-9).

import type { Embedder } from '../embedding/types.js';
import type { QueryFlowDependencies } from '../generation/query-flow.js';
import { elapsedMs } from '../http.js';
import type { VectorIndex } from '../retrieval/embedding-store.js';
import { denseRanking } from '../retrieval/hybrid.js';

/** The `topK` chunks most similar to the instruction, and the time spent embedding it. */
export function createDenseSearch(
  embedder: Embedder,
  vectorIndex: VectorIndex,
  topK: number,
): QueryFlowDependencies['search'] {
  return async (instruction) => {
    const started = performance.now();
    const [query] = await embedder.embed([instruction], 'query');
    const embedMs = elapsedMs(started);
    const candidates = denseRanking(vectorIndex, query.dense, topK).map((chunkId) => ({
      chunkId,
      origin: 'dense' as const,
    }));
    return { candidates, embedMs };
  };
}
