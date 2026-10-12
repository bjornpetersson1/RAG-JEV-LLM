// Builds the configured retriever from `.env` and the database. Tag search needs nothing more;
// `bge` and `both` load the embedder and every chunk's vector, and fail when `index:embed` has not
// embedded the current chunks with the current embedder.

import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import { createEmbedder } from '../embedding/factory.js';
import type { Embedder } from '../embedding/types.js';
import type { CandidateSearch } from '../search/candidate-search.js';
import { loadRetrievalConfig } from './config.js';
import { loadVectorIndex, type EmbeddingIdentity, type VectorIndex } from './embedding-store.js';
import { createRetriever, type Retriever } from './retriever.js';

/** What the stored embeddings must have been made with: the embedder's model and precision. */
export function embeddingIdentity(embedder: Embedder): EmbeddingIdentity {
  return { model: embedder.model, dtype: embedder.dtype };
}

/** The embedder and every chunk's vector, loaded once and shared by the bge and both retrievers. */
export interface RetrievalResources {
  embedder: Embedder;
  vectorIndex: VectorIndex;
}

/**
 * Where a flow gets its embedder and vectors: resources already loaded (shared between flows), an
 * embedder whose vectors are still to be loaded (a fake one in tests), or by default `EMBEDDER`.
 */
export type RetrievalSource = RetrievalResources | Embedder | undefined;

/** Fails, naming `npm run index:embed`, when the chunks are not embedded with this embedder. */
export function loadRetrievalResources(
  db: DatabaseSync,
  env: Env,
  source?: RetrievalSource,
): RetrievalResources {
  if (source && 'vectorIndex' in source) return source;
  const embedder = source ?? createEmbedder(env);
  return { embedder, vectorIndex: loadVectorIndex(db, embeddingIdentity(embedder)) };
}

/** The retriever `RETRIEVER` selects; `bge` and `both` load the embedder and vectors. */
export function createConfiguredRetriever(
  db: DatabaseSync,
  env: Env,
  candidateSearch: CandidateSearch,
  source?: RetrievalSource,
): Retriever {
  const config = loadRetrievalConfig(env);
  if (config.retriever === 'tags') return createRetriever(config, { db, candidateSearch });
  return createRetriever(config, {
    db,
    candidateSearch,
    ...loadRetrievalResources(db, env, source),
  });
}
