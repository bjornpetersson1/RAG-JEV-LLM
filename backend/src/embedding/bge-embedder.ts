import { spellOutLawAbbreviations } from '../legal/law-names.js';
import { BGE_M3_MODEL } from '../models/catalog.js';
import { loadLocalModelConfig, type LocalModelConfig } from '../models/config.js';
import { inBatches, lazyRetry, loadTextEncoder } from '../models/runtime.js';
import type { Embedder, EmbedderEntry, Embedding } from './types.js';

/** bge-m3, dense only (E8-2), on the local model runtime. */
export const bgeEmbedder: EmbedderEntry = {
  validate(env) {
    loadLocalModelConfig(env, 'EMBEDDER');
  },
  create(env) {
    return createBgeEmbedder(loadLocalModelConfig(env, 'EMBEDDER'));
  },
};

/**
 * Embeds with bge-m3: the [CLS] vector, scaled to unit length. bge-m3 needs no query prefix; a
 * query gets its law abbreviations spelled out, since the model does not know them. The model
 * loads on the first call and runs in batches of `config.batchSize`.
 */
export function createBgeEmbedder(
  config: LocalModelConfig,
  loadEncoder: typeof loadTextEncoder = loadTextEncoder,
): Embedder {
  const encoder = lazyRetry(() => loadEncoder(BGE_M3_MODEL, config.dtype, config.cacheDir));
  return {
    name: 'bge',
    model: BGE_M3_MODEL,
    dtype: config.dtype,
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      const encode = await encoder();
      const inputs = kind === 'query' ? texts.map(spellOutLawAbbreviations) : texts;
      const embeddings: Embedding[] = [];
      for (const batch of inBatches(inputs, config.batchSize)) {
        const vectors = await encode(batch);
        embeddings.push(...vectors.map((vector) => ({ dense: unitLength(vector) })));
      }
      return embeddings;
    },
  };
}

/** `vector` scaled in place to length 1, so a dot product is the cosine similarity. */
export function unitLength(vector: Float32Array): Float32Array {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (norm === 0) throw new Error('Cannot normalise a zero vector');
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}
