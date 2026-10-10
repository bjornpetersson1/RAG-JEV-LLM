import { readPositiveInteger } from '../env.js';

export interface TaggingConfig {
  /** How many chunks are tagged at the same time. */
  concurrency: number;
}

export const DEFAULT_TAGGING_CONFIG: TaggingConfig = { concurrency: 4 };

/** Reads `TAGGER_CONCURRENCY`; unset uses the default. */
export function loadTaggingConfig(env: Record<string, string | undefined>): TaggingConfig {
  return {
    concurrency: readPositiveInteger(env, 'TAGGER_CONCURRENCY', DEFAULT_TAGGING_CONFIG.concurrency),
  };
}
