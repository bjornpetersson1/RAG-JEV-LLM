import { readBoolean, readOneOf, readPositiveInteger } from '../env.js';
import { bloomIndexBuilder, type BloomSettings } from './bloom-index.js';
import { buildRoaringIndex } from './roaring-index.js';
import type { BuildTagIndex } from './tag-index.js';

const TAG_INDEX_KINDS = ['roaring', 'bloom'] as const;

export interface SearchConfig {
  /** Which {@link TagIndex} implementation the server builds. */
  tagIndex: (typeof TAG_INDEX_KINDS)[number];
  bloom: BloomSettings;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  tagIndex: 'roaring',
  bloom: { bits: 128, hashes: 6, verify: true },
};

/** Reads `TAG_INDEX` and the `BLOOM_*` settings; unset uses the defaults. */
export function loadSearchConfig(env: Record<string, string | undefined>): SearchConfig {
  const defaults = DEFAULT_SEARCH_CONFIG.bloom;
  const bits = readPositiveInteger(env, 'BLOOM_BITS', defaults.bits);
  const hashes = readPositiveInteger(env, 'BLOOM_HASHES', defaults.hashes);
  if (hashes > bits) {
    throw new Error(`Invalid BLOOM_HASHES ${hashes}: expected at most BLOOM_BITS (${bits})`);
  }
  return {
    tagIndex: readOneOf(env, 'TAG_INDEX', TAG_INDEX_KINDS, DEFAULT_SEARCH_CONFIG.tagIndex),
    bloom: { bits, hashes, verify: readBoolean(env, 'BLOOM_VERIFY', defaults.verify) },
  };
}

/** The builder for the implementation `config` selects. */
export function tagIndexBuilder({ tagIndex, bloom }: SearchConfig): BuildTagIndex {
  return tagIndex === 'bloom' ? bloomIndexBuilder(bloom) : buildRoaringIndex;
}
