import { describe, expect, it } from 'vitest';
import { buildBloomIndex, theoreticalFalsePositiveRate } from './bloom-index.js';
import { DEFAULT_SEARCH_CONFIG } from './config.js';
import { measureFalsePositives } from './false-positives.js';
import { buildRoaringIndex } from './roaring-index.js';
import { generateSyntheticData, syntheticQueries } from './synthetic.js';
import { describeTagIndexContract } from './test-helpers.js';

describeTagIndexContract('bloom index with verification', (chunkTags) =>
  buildBloomIndex(chunkTags, { ...DEFAULT_SEARCH_CONFIG.bloom, verify: true }),
);

describe('bloom index without verification', () => {
  it('returns every true match in every mode, with counts at least the true ones', () => {
    const { slugs, chunkTags } = generateSyntheticData({ chunks: 3000, tags: 60, seed: 11 });
    // A small signature makes false positives common, so the check is not trivially passed.
    const bloom = buildBloomIndex(chunkTags, { bits: 16, hashes: 2, verify: false });
    const exact = buildRoaringIndex(chunkTags);
    try {
      const queries = syntheticQueries(slugs, { count: 20, size: 3, seed: 5 });
      for (const tags of queries) {
        for (const mode of ['searchAll', 'searchAny'] as const) {
          const found = new Set(bloom[mode](tags));
          const missed = exact[mode](tags).filter((chunkId) => !found.has(chunkId));
          expect(missed).toEqual([]);
        }
        const limit = bloom.chunkCount;
        const bloomMatches = new Map(
          bloom.searchRanked(tags, { limit }).map((hit) => [hit.chunkId, hit.matches]),
        );
        for (const { chunkId, matches } of exact.searchRanked(tags, { limit })) {
          expect(bloomMatches.get(chunkId)).toBeGreaterThanOrEqual(matches);
        }
      }
      expect(measureFalsePositives(exact, bloom, queries).perTagTest).toBeGreaterThan(0);
    } finally {
      exact.dispose();
    }
  });
});

describe('bloom index settings', () => {
  it('reports its settings and theoretical false positive rate', () => {
    const index = buildBloomIndex(
      [
        { chunkId: 1, slug: 'lon' },
        { chunkId: 1, slug: 'semester' },
        { chunkId: 2, slug: 'lon' },
      ],
      { bits: 64, hashes: 3, verify: false },
    );

    expect(index.description).toEqual({
      implementation: 'bloom',
      bits: 64,
      hashes: 3,
      verify: false,
      falsePositiveRate: theoreticalFalsePositiveRate({ bits: 64, hashes: 3 }, 1.5),
    });
  });

  it('rejects more tags than its 16-bit tag lists can hold', () => {
    const chunkTags = Array.from({ length: 0x10001 }, (_, i) => ({ chunkId: 1, slug: `t${i}` }));
    expect(() => buildBloomIndex(chunkTags, { bits: 8, hashes: 1, verify: true })).toThrow(
      'The bloom index supports at most 65536 tags, got 65537',
    );
  });

  it('computes the theoretical rate as (1 − e^(−kn/m))^k', () => {
    expect(theoreticalFalsePositiveRate({ bits: 128, hashes: 6 }, 5.5)).toBeCloseTo(
      (1 - Math.exp((-6 * 5.5) / 128)) ** 6,
      12,
    );
    expect(theoreticalFalsePositiveRate({ bits: 128, hashes: 6 }, 5.5)).toBeLessThan(0.001);
  });
});
