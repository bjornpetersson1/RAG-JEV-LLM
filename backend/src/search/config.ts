import { readBoolean, readOneOf, readPositiveInteger } from '../env.js';
import { bloomIndexBuilder, type BloomSettings } from './bloom-index.js';
import { buildRoaringIndex } from './roaring-index.js';
import type { BuildTagIndex } from './tag-index.js';

const TAG_INDEX_KINDS = ['roaring', 'bloom'] as const;

export interface SearchConfig {
  /** Which {@link TagIndex} implementation the server builds. */
  tagIndex: (typeof TAG_INDEX_KINDS)[number];
  bloom: BloomSettings;
  /** Below this many tag candidates, full-text search fills up (N). */
  minTagCandidates: number;
  /** At most this many candidates in total. */
  maxCandidates: number;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  tagIndex: 'roaring',
  bloom: { bits: 128, hashes: 6, verify: true },
  minTagCandidates: 10,
  maxCandidates: 30,
};

/**
 * Reads `TAG_INDEX`, the `BLOOM_*` settings, `MIN_TAG_CANDIDATES` and `MAX_CANDIDATES`; unset uses
 * the defaults.
 */
export function loadSearchConfig(env: Record<string, string | undefined>): SearchConfig {
  const defaults = DEFAULT_SEARCH_CONFIG.bloom;
  const bits = readPositiveInteger(env, 'BLOOM_BITS', defaults.bits);
  const hashes = readPositiveInteger(env, 'BLOOM_HASHES', defaults.hashes);
  if (hashes > bits) {
    throw new Error(`Invalid BLOOM_HASHES ${hashes}: expected at most BLOOM_BITS (${bits})`);
  }
  const minTagCandidates = readPositiveInteger(
    env,
    'MIN_TAG_CANDIDATES',
    DEFAULT_SEARCH_CONFIG.minTagCandidates,
  );
  const maxCandidates = readPositiveInteger(
    env,
    'MAX_CANDIDATES',
    DEFAULT_SEARCH_CONFIG.maxCandidates,
  );
  if (minTagCandidates > maxCandidates) {
    throw new Error(
      `Invalid MIN_TAG_CANDIDATES ${minTagCandidates}: expected at most MAX_CANDIDATES (${maxCandidates})`,
    );
  }
  return {
    tagIndex: readOneOf(env, 'TAG_INDEX', TAG_INDEX_KINDS, DEFAULT_SEARCH_CONFIG.tagIndex),
    bloom: { bits, hashes, verify: readBoolean(env, 'BLOOM_VERIFY', defaults.verify) },
    minTagCandidates,
    maxCandidates,
  };
}

/** The builder for the implementation `config` selects. */
export function tagIndexBuilder({ tagIndex, bloom }: SearchConfig): BuildTagIndex {
  return tagIndex === 'bloom' ? bloomIndexBuilder(bloom) : buildRoaringIndex;
}
