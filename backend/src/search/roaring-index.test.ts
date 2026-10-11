import { describe, expect, it } from 'vitest';
import { buildRoaringIndex } from './roaring-index.js';
import { generateSyntheticData, syntheticQueries } from './synthetic.js';
import { EMPTY_TAG_INDEX, type ChunkTag } from './tag-index.js';
import { describeTagIndexContract } from './test-helpers.js';

describeTagIndexContract('roaring index', buildRoaringIndex);

describe('roaring index on synthetic data', () => {
  it('matches a brute-force search in every mode', () => {
    const { slugs, chunkTags } = generateSyntheticData({ chunks: 2000, tags: 40, seed: 7 });
    const index = buildRoaringIndex(chunkTags);
    try {
      for (const tags of syntheticQueries(slugs, { count: 20, size: 3, seed: 9 })) {
        const expected = bruteForce(chunkTags, tags);
        expect(index.searchAll(tags)).toEqual(expected.filter((hit) => hit.matches === 3).map(id));
        expect(index.searchAny(tags)).toEqual(expected.map(id));
        expect(index.searchRanked(tags, { limit: 50 })).toEqual(
          [...expected].sort((a, b) => b.matches - a.matches || a.chunkId - b.chunkId).slice(0, 50),
        );
      }
    } finally {
      index.dispose();
    }
  });
});

describe('roaring index with sparse chunk ids', () => {
  it('ranks chunks whose ids are far apart, as after repeated re-chunking', () => {
    const index = buildRoaringIndex([
      { chunkId: 900_000, slug: 'lon' },
      { chunkId: 900_000, slug: 'semester' },
      { chunkId: 5, slug: 'lon' },
      { chunkId: 4_000_000_000, slug: 'semester' },
    ]);
    try {
      expect(index.chunkCount).toBe(3);
      expect(index.searchRanked(['lon', 'semester'])).toEqual([
        { chunkId: 900_000, matches: 2 },
        { chunkId: 5, matches: 1 },
        { chunkId: 4_000_000_000, matches: 1 },
      ]);
    } finally {
      index.dispose();
    }
  });
});

describe('EMPTY_TAG_INDEX', () => {
  it('finds nothing and still validates ranked options', () => {
    expect(EMPTY_TAG_INDEX.searchAll(['lon'])).toEqual([]);
    expect(EMPTY_TAG_INDEX.searchAny(['lon'])).toEqual([]);
    expect(EMPTY_TAG_INDEX.searchRanked(['lon'])).toEqual([]);
    expect(() => EMPTY_TAG_INDEX.searchRanked(['lon'], { limit: 0 })).toThrow(RangeError);
  });
});

/** Every chunk with at least one of `tags` and its match count, in ascending id order. */
function bruteForce(chunkTags: ChunkTag[], tags: string[]) {
  const matches = new Map<number, number>();
  for (const { chunkId, slug } of chunkTags) {
    if (tags.includes(slug)) matches.set(chunkId, (matches.get(chunkId) ?? 0) + 1);
  }
  return [...matches]
    .sort(([a], [b]) => a - b)
    .map(([chunkId, count]) => ({ chunkId, matches: count }));
}

function id({ chunkId }: { chunkId: number }): number {
  return chunkId;
}
