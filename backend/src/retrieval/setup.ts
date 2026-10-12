// Builds the configured retriever from `.env` and the database. Tag search needs nothing more;
// `bge` and `both` load the embedder and every chunk's vector, and fail when `index:embed` has not
// embedded the current chunks with the current embedder.

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db/database.js';
import type { Env } from '../env.js';
import { createEmbedder } from '../embedding/factory.js';
import { describeError } from '../errors.js';
import type { Embedder } from '../embedding/types.js';
import type { CandidateSearch } from '../search/candidate-search.js';
import { loadRetrievalConfig } from './config.js';
import {
  assertEmbeddingsReady,
  loadVectorIndex,
  type EmbeddingIdentity,
  type VectorIndex,
} from './embedding-store.js';
import { createRetriever, type Retriever } from './retriever.js';

/** What the stored embeddings must have been made with: the embedder's model and precision. */
export function embeddingIdentity(embedder: Embedder): EmbeddingIdentity {
  return { model: embedder.model, dtype: embedder.dtype };
}

/**
 * For server startup: fails unless every chunk has an up-to-date embedding from the configured
 * embedder, when `RETRIEVER` needs them. Opens the database read-only; loads no model or vectors.
 */
export function checkRetrieverReady(databasePath: string, env: Env): void {
  const { retriever } = loadRetrievalConfig(env);
  if (retriever === 'tags') return;
  const db = openDatabase(databasePath, { readOnly: true });
  try {
    assertEmbeddingsReady(db, embeddingIdentity(createEmbedder(env)));
  } catch (error) {
    throw new Error(`RETRIEVER=${retriever}: ${describeError(error)}`, { cause: error });
  } finally {
    db.close();
  }
}

/** The embedder and every chunk's vector, loaded once and shared by the bge and both retrievers. */
export interface RetrievalResources {
  embedder: Embedder;
  vectorIndex: VectorIndex;
}

/** Fails, naming `npm run index:embed`, when the chunks are not embedded with this embedder. */
export function loadRetrievalResources(
  db: DatabaseSync,
  env: Env,
  /** A fake embedder in tests; by default `EMBEDDER`. */
  embedder: Embedder = createEmbedder(env),
): RetrievalResources {
  return { embedder, vectorIndex: loadVectorIndex(db, embeddingIdentity(embedder)) };
}

/** The retriever `RETRIEVER` selects; `bge` and `both` load the embedder and vectors. */
export function createConfiguredRetriever(
  db: DatabaseSync,
  env: Env,
  candidateSearch: CandidateSearch,
  embedder?: Embedder,
): Retriever {
  const config = loadRetrievalConfig(env);
  if (config.retriever === 'tags') return createRetriever(config, { db, candidateSearch });
  return createRetriever(config, {
    db,
    candidateSearch,
    ...loadRetrievalResources(db, env, embedder),
  });
}
