// The candidate source `RETRIEVER` selects: tag search with its full-text fallback (E4), the only
// one left since the local embedder was removed (E10-1).

import { elapsedMs } from '../http.js';
import type { Candidate, CandidateSearch } from '../search/candidate-search.js';
import type { RetrievalConfig, RetrieverName } from './config.js';

export interface Retrieval {
  /** Best first. */
  candidates: Candidate[];
  /** Time for the search. */
  searchMs: number;
}

export interface Retriever {
  readonly name: RetrieverName;
  retrieve(instruction: string, tags: readonly string[]): Promise<Retrieval>;
}

export function createRetriever(
  { retriever: name }: RetrievalConfig,
  candidateSearch: CandidateSearch,
): Retriever {
  return {
    name,
    async retrieve(instruction, tags) {
      const started = performance.now();
      const { candidates } = candidateSearch.search({ instruction, tags, mode: 'tags+fts' });
      return { candidates, searchMs: elapsedMs(started) };
    },
  };
}
