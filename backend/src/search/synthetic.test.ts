import { describe, expect, it } from 'vitest';
import { generateSyntheticData, syntheticQueries } from './synthetic.js';

describe('generateSyntheticData', () => {
  it('gives the same data for the same seed and other data for another seed', () => {
    const options = { chunks: 500, tags: 30, seed: 3 };
    expect(generateSyntheticData(options)).toEqual(generateSyntheticData(options));
    expect(generateSyntheticData({ ...options, seed: 4 }).chunkTags).not.toEqual(
      generateSyntheticData(options).chunkTags,
    );
  });

  it('gives every chunk a number of distinct tags within the configured range', () => {
    const { chunkTags } = generateSyntheticData({
      chunks: 1000,
      tags: 20,
      minTagsPerChunk: 2,
      maxTagsPerChunk: 5,
    });
    const tagsPerChunk = new Map<number, Set<string>>();
    for (const { chunkId, slug } of chunkTags) {
      tagsPerChunk.set(chunkId, (tagsPerChunk.get(chunkId) ?? new Set()).add(slug));
    }
    expect(tagsPerChunk.size).toBe(1000);
    // No chunk has the same tag twice.
    expect([...tagsPerChunk.values()].reduce((sum, tags) => sum + tags.size, 0)).toBe(
      chunkTags.length,
    );
    const counts = [...tagsPerChunk.values()].map((tags) => tags.size);
    expect(Math.min(...counts)).toBe(2);
    expect(Math.max(...counts)).toBe(5);
  });

  it('makes the first tags the most popular with the default skew', () => {
    const { slugs, chunkTags } = generateSyntheticData({ chunks: 2000, tags: 50 });
    const uses = (slug: string) => chunkTags.filter((tag) => tag.slug === slug).length;
    expect(uses(slugs[0])).toBeGreaterThan(uses(slugs[49]) * 5);
  });

  it('rejects a tags-per-chunk range that cannot be filled', () => {
    expect(() => generateSyntheticData({ tags: 4, maxTagsPerChunk: 5 })).toThrow(RangeError);
    expect(() => generateSyntheticData({ minTagsPerChunk: 6, maxTagsPerChunk: 5 })).toThrow(
      RangeError,
    );
  });
});

describe('syntheticQueries', () => {
  it('gives deterministic queries of distinct known tags', () => {
    const { slugs } = generateSyntheticData({ chunks: 10, tags: 30 });
    const queries = syntheticQueries(slugs, { count: 10, size: 5, seed: 1 });
    expect(queries).toEqual(syntheticQueries(slugs, { count: 10, size: 5, seed: 1 }));
    for (const query of queries) {
      expect(new Set(query).size).toBe(5);
      for (const slug of query) expect(slugs).toContain(slug);
    }
  });

  it('rejects a query size larger than the number of tags', () => {
    expect(() => syntheticQueries(['a', 'b'], { count: 1, size: 3 })).toThrow(RangeError);
  });
});
