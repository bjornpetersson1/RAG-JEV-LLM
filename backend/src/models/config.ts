import { resolve } from 'node:path';
import { readOneOf, readPositiveInteger, type Env } from '../env.js';
import { REPO_ROOT } from '../repo-root.js';

/** The precisions the local models run in: fp32 (full) or int8 (quantised, about a quarter the size). */
export const MODEL_DTYPES = ['int8', 'fp32'] as const;
export type ModelDtype = (typeof MODEL_DTYPES)[number];

// `.nosync`: iCloud Drive does not sync a folder with this suffix, should the repo be in one.
const DEFAULT_MODEL_CACHE_DIR = 'data/models.nosync';

/** Absolute model cache directory from `MODEL_CACHE_DIR`; relative values resolve from the repo root. */
export function resolveModelCacheDir(env: Env): string {
  return resolve(REPO_ROOT, env.MODEL_CACHE_DIR?.trim() || DEFAULT_MODEL_CACHE_DIR);
}

export interface LocalModelConfig {
  dtype: ModelDtype;
  cacheDir: string;
  /** Texts per model call; larger batches pad more and use more memory. */
  batchSize: number;
}

/** `<prefix>_DTYPE`, `<prefix>_BATCH_SIZE` and `MODEL_CACHE_DIR`, e.g. for prefix `EMBEDDER`. */
export function loadLocalModelConfig(env: Env, prefix: string): LocalModelConfig {
  return {
    dtype: readOneOf(env, `${prefix}_DTYPE`, MODEL_DTYPES, 'int8'),
    cacheDir: resolveModelCacheDir(env),
    batchSize: readPositiveInteger(env, `${prefix}_BATCH_SIZE`, 8),
  };
}
