import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IndexLogger } from './load-index.js';
import type { BuildTagIndex, ChunkTag, TagIndex } from './tag-index.js';

/** Chunk ids per tag in the contract data set. */
const TAGGED: Record<string, number[]> = {
  uppsagning: [1, 2, 3, 5, 8],
  sekretess: [2, 3, 4, 8],
  lon: [3, 6, 8],
  semester: [7],
};

/** The pairs of {@link TAGGED}. */
const CONTRACT_CHUNK_TAGS: ChunkTag[] = Object.entries(TAGGED).flatMap(([slug, ids]) =>
  ids.map((chunkId) => ({ chunkId, slug })),
);

/**
 * The behaviour every {@link TagIndex} must have, run against the implementation `build` creates.
 * Both the roaring index (E4-1) and the bloom filter index (E4-2) run it.
 */
export function describeTagIndexContract(name: string, build: BuildTagIndex): void {
  describe(`${name} (TagIndex contract)`, () => {
    let index: TagIndex;

    beforeAll(() => {
      index = build(CONTRACT_CHUNK_TAGS);
    });

    afterAll(() => index.dispose());

    it('counts distinct chunks and tags', () => {
      expect(index.chunkCount).toBe(8);
      expect(index.tagCount).toBe(4);
    });

    it('AND returns the chunks with every tag, in ascending order', () => {
      expect(index.searchAll(['sekretess', 'uppsagning'])).toEqual([2, 3, 8]);
      expect(index.searchAll(['uppsagning', 'sekretess', 'lon'])).toEqual([3, 8]);
      expect(index.searchAll(['lon'])).toEqual([3, 6, 8]);
    });

    it('OR returns the chunks with any tag, in ascending order', () => {
      expect(index.searchAny(['lon', 'semester'])).toEqual([3, 6, 7, 8]);
      expect(index.searchAny(['sekretess', 'uppsagning'])).toEqual([1, 2, 3, 4, 5, 8]);
    });

    it('returns an empty result for an empty query or no match', () => {
      expect(index.searchAll([])).toEqual([]);
      expect(index.searchAny([])).toEqual([]);
      expect(index.searchRanked([])).toEqual([]);
      expect(index.searchAll(['semester', 'lon'])).toEqual([]);
    });

    it('treats an unknown tag as matching nothing', () => {
      expect(index.searchAll(['lon', 'okand'])).toEqual([]);
      expect(index.searchAll(['okand'])).toEqual([]);
      expect(index.searchAny(['lon', 'okand'])).toEqual([3, 6, 8]);
      expect(index.searchAny(['okand'])).toEqual([]);
      expect(index.searchRanked(['semester', 'okand'])).toEqual([{ chunkId: 7, matches: 1 }]);
    });

    it('counts a repeated tag once', () => {
      expect(index.searchAll(['lon', 'lon'])).toEqual([3, 6, 8]);
      expect(index.searchAny(['semester', 'semester'])).toEqual([7]);
      expect(index.searchRanked(['semester', 'semester'])).toEqual([{ chunkId: 7, matches: 1 }]);
    });

    it('ranks by matching tags, most first, then ascending id', () => {
      expect(index.searchRanked(['uppsagning', 'sekretess', 'lon'])).toEqual([
        { chunkId: 3, matches: 3 },
        { chunkId: 8, matches: 3 },
        { chunkId: 2, matches: 2 },
        { chunkId: 1, matches: 1 },
        { chunkId: 4, matches: 1 },
        { chunkId: 5, matches: 1 },
        { chunkId: 6, matches: 1 },
      ]);
    });

    it('applies the minimum match count and the limit', () => {
      const tags = ['uppsagning', 'sekretess', 'lon'];
      expect(index.searchRanked(tags, { minMatches: 2 })).toEqual([
        { chunkId: 3, matches: 3 },
        { chunkId: 8, matches: 3 },
        { chunkId: 2, matches: 2 },
      ]);
      expect(index.searchRanked(tags, { limit: 4 })).toEqual([
        { chunkId: 3, matches: 3 },
        { chunkId: 8, matches: 3 },
        { chunkId: 2, matches: 2 },
        { chunkId: 1, matches: 1 },
      ]);
      expect(index.searchRanked(tags, { minMatches: 4 })).toEqual([]);
    });

    it('counts a chunk–tag pair given twice once', () => {
      const repeated = build([...CONTRACT_CHUNK_TAGS, { chunkId: 7, slug: 'semester' }]);
      try {
        expect(repeated.searchAll(['semester'])).toEqual([7]);
        expect(repeated.searchRanked(['semester', 'lon'])).toEqual(
          index.searchRanked(['semester', 'lon']),
        );
      } finally {
        repeated.dispose();
      }
    });

    it('gives the same ranking when searched again', () => {
      const tags = ['uppsagning', 'lon'];
      expect(index.searchRanked(tags)).toEqual(index.searchRanked(tags));
    });

    it('rejects a minimum match count or limit that is not a positive integer', () => {
      for (const options of [{ minMatches: 0 }, { limit: 0 }, { limit: 1.5 }, { minMatches: -1 }]) {
        expect(() => index.searchRanked(['lon'], options)).toThrow(RangeError);
      }
    });
  });
}

/** A logger whose calls tests can inspect. */
export function createIndexLogger() {
  return { info: vi.fn(), warn: vi.fn() } satisfies IndexLogger;
}
