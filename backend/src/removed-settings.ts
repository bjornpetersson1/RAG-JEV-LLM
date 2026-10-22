// Settings and values that went with the local models (E10-1): each is rejected by name, so an old
// `.env` fails at startup instead of being silently ignored. The server and every CLI that builds a
// flow check them first, before any config loader reads `.env`.

import type { Env } from './env.js';

const REMOVED_LOCAL_MODELS = 'the local models were removed (E10-1)';

/** Settings that no longer exist; any non-empty value is rejected. */
export const REMOVED_SETTINGS = [
  'RETRIEVE_CANDIDATES',
  'RRF_K',
  'RRF_WEIGHT_DENSE',
  'RRF_WEIGHT_LEXICAL',
  'RRF_WEIGHT_TAGS',
  'RERANK_THRESHOLD_BGE',
  'RERANK_THRESHOLD_MINILM',
  'RERANKER_DTYPE',
  'RERANKER_BATCH_SIZE',
  'MODEL_CACHE_DIR',
  'EMBEDDER',
  'EMBEDDER_DTYPE',
  'EMBEDDER_BATCH_SIZE',
] as const;

/** Values of settings that still exist, which named a local model. */
export const REMOVED_VALUES: Readonly<Record<string, readonly string[]>> = {
  RETRIEVER: ['bge', 'both'],
  RERANKER: ['bge', 'minilm', 'qwen3'],
};

/** Throws, naming the setting, on the first removed setting or value set in `env`. */
export function rejectRemovedSettings(env: Env): void {
  for (const key of REMOVED_SETTINGS) {
    if (env[key]?.trim()) {
      throw new Error(`${key} was removed: ${REMOVED_LOCAL_MODELS}; remove ${key} from .env`);
    }
  }
  for (const [key, values] of Object.entries(REMOVED_VALUES)) {
    const value = env[key]?.trim();
    if (value && values.includes(value)) {
      throw new Error(`${key}=${value} was removed: ${REMOVED_LOCAL_MODELS}; remove it from .env`);
    }
  }
}
