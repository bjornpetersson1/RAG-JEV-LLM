import { describe, expect, it } from 'vitest';
import { measureFalsePositives } from './false-positives.js';
import { buildRoaringIndex } from './roaring-index.js';

describe('measureFalsePositives', () => {
  it('counts a wrong hit per tag test even when the approximate index also misses one', () => {
    const exact = buildRoaringIndex([
      { chunkId: 1, slug: 'lon' },
      { chunkId: 2, slug: 'vite' },
      { chunkId: 3, slug: 'vite' },
    ]);
    // "lon" is on chunk 2 instead of chunk 1: one miss and one false positive.
    const approximate = buildRoaringIndex([
      { chunkId: 1, slug: 'vite' },
      { chunkId: 2, slug: 'lon' },
      { chunkId: 2, slug: 'vite' },
      { chunkId: 3, slug: 'vite' },
    ]);
    try {
      expect(measureFalsePositives(exact, approximate, [['lon']]).perTagTest).toBe(1 / 2);
    } finally {
      exact.dispose();
      approximate.dispose();
    }
  });

  it('counts the hits the approximate index gets wrong, per mode and per tag test', () => {
    const exact = buildRoaringIndex([
      { chunkId: 1, slug: 'lon' },
      { chunkId: 2, slug: 'lon' },
      { chunkId: 2, slug: 'semester' },
      { chunkId: 3, slug: 'semester' },
      { chunkId: 4, slug: 'vite' },
    ]);
    // Chunk 4 wrongly also has "lon", as a false positive would give it.
    const approximate = buildRoaringIndex([
      { chunkId: 1, slug: 'lon' },
      { chunkId: 2, slug: 'lon' },
      { chunkId: 2, slug: 'semester' },
      { chunkId: 3, slug: 'semester' },
      { chunkId: 4, slug: 'vite' },
      { chunkId: 4, slug: 'lon' },
    ]);
    try {
      expect(measureFalsePositives(exact, approximate, [['lon', 'semester']])).toEqual({
        // "lon" matches 1 of the 2 chunks without it, "semester" none of its 2.
        perTagTest: 1 / 4,
        searchAll: 0,
        // Chunks 1–4 found, chunk 4 wrongly.
        searchAny: 1 / 4,
        searchRanked: 1 / 4,
      });
    } finally {
      exact.dispose();
      approximate.dispose();
    }
  });
});
