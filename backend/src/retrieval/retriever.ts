// The candidate source `RETRIEVER` selects (E8-4): tag search with its full-text fallback (E4),
// bge-m3 hybrid search (dense + BM25, fused by RRF), or both of those fused by RRF.

import type { DatabaseSync } from 'node:sqlite';
import type { Embedder } from '../embedding/types.js';
import { elapsedMs } from '../http.js';
import type { Candidate, CandidateSearch } from '../search/candidate-search.js';
import type { RetrievalConfig, RetrieverName } from './config.js';
import type { VectorIndex } from './embedding-store.js';
import {
  denseRanking,
  fuseRankings,
  lexicalQuery,
  lexicalRanking,
  namedFirst,
  namedProvisionChunks,
  type Ranking,
} from './hybrid.js';

export interface Retrieval {
  /** Best first. */
  candidates: Candidate[];
  /** Time to embed the instruction; absent when it was not embedded (tag search). */
  embedMs?: number;
  /** Time for the searches and the fusion. */
  searchMs: number;
}

export interface Retriever {
  readonly name: RetrieverName;
  /** Whether `retrieve` uses the instruction's tags, i.e. whether query translation is needed. */
  readonly usesTags: boolean;
  /** The embedder's model and precision, for a retriever that embeds the instruction. */
  readonly embedder?: Pick<Embedder, 'model' | 'dtype'>;
  retrieve(instruction: string, tags: readonly string[]): Promise<Retrieval>;
}

export interface RetrieverDependencies {
  db: DatabaseSync;
  candidateSearch: CandidateSearch;
  /** Required for `bge` and `both`. */
  embedder?: Embedder;
  /** Required for `bge` and `both`: every chunk's vector, from `index:embed`. */
  vectorIndex?: VectorIndex;
}

export function createRetriever(config: RetrievalConfig, deps: RetrieverDependencies): Retriever {
  const { retriever: name, candidates: limit, rrfK, weights } = config;
  const { db, candidateSearch, embedder, vectorIndex } = deps;

  if (name === 'tags') {
    return {
      name,
      usesTags: true,
      async retrieve(instruction, tags) {
        const started = performance.now();
        const { candidates } = candidateSearch.search({ instruction, tags, mode: 'tags+fts' });
        return { candidates, searchMs: elapsedMs(started) };
      },
    };
  }

  if (!embedder || !vectorIndex) {
    throw new Error(`RETRIEVER=${name} needs the embedder and the vector index`);
  }
  return {
    name,
    usesTags: name === 'both',
    // With the dense half switched off (weight 0), the instruction is never embedded.
    ...(weights.dense > 0 && { embedder }),
    async retrieve(instruction, tags) {
      const embedStarted = performance.now();
      const [query] = weights.dense > 0 ? await embedder.embed([instruction], 'query') : [];
      const embedMs = elapsedMs(embedStarted);

      const searchStarted = performance.now();
      const rankings: Ranking[] = [
        {
          origin: 'dense',
          chunkIds: query ? denseRanking(vectorIndex, query.dense, limit) : [],
          weight: weights.dense,
        },
        {
          origin: 'lexical',
          chunkIds: lexicalRanking(db, lexicalQuery(instruction), limit),
          weight: weights.lexical,
        },
      ];
      if (name === 'both') {
        const { candidates } = candidateSearch.search({ instruction, tags, mode: 'tags' });
        rankings.push({
          origin: 'tag',
          chunkIds: candidates.map(({ chunkId }) => chunkId),
          weight: weights.tags,
        });
      }
      // A provision the instruction names is always a candidate, first: neither half ranks an exact
      // section reliably, since other sections of the same law share its words and numbers.
      const candidates = namedFirst(
        namedProvisionChunks(db, instruction),
        fuseRankings(rankings, rrfK, limit),
        limit,
      );
      return { candidates, ...(query && { embedMs }), searchMs: elapsedMs(searchStarted) };
    },
  };
}
