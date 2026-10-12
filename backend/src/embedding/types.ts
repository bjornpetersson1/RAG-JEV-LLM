import type { Env } from '../env.js';

/** A text's embedding: a unit-length dense vector and, if the model gives them, lexical weights. */
export interface Embedding {
  dense: Float32Array;
  /** Token → weight, for models with sparse output (bge-m3); absent otherwise. */
  sparse?: Map<string, number>;
}

/** Queries and passages may be embedded differently by a model. */
export type EmbedKind = 'query' | 'passage';

export interface Embedder {
  /** The `EMBEDDER` value, e.g. `bge`. */
  readonly name: string;
  readonly model: string;
  /** The precision the model runs in, e.g. `int8`; stored vectors are keyed by model and this. */
  readonly dtype: string;
  /** One embedding per text, in order; batching happens inside. */
  embed(texts: readonly string[], kind: EmbedKind): Promise<Embedding[]>;
}

/** One `EMBEDDER` value: a new file with one of these plus a registry entry. */
export interface EmbedderEntry {
  /** Reads the embedder's own settings from `env` and throws on an invalid or missing one. */
  validate(env: Env): void;
  create(env: Env): Embedder;
}
