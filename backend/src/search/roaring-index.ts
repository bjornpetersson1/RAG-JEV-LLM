import { RoaringBitmap32, roaringLibraryInitialize } from 'roaring-wasm';
import {
  BaseTagIndex,
  ordinalsOf,
  rankByMatches,
  type BuildTagIndex,
  type ChunkTag,
  type RankedHit,
  type RankedOptions,
} from './tag-index.js';

// Once per process, so building an index (and timing it) never includes compiling the WASM module.
await roaringLibraryInitialize();

/** The inverted index: one roaring bitmap of chunk ids per tag slug. */
export const buildRoaringIndex: BuildTagIndex = (chunkTags) => new RoaringTagIndex(chunkTags);

class RoaringTagIndex extends BaseTagIndex {
  readonly chunkCount: number;
  readonly tagCount: number;
  readonly description = { implementation: 'roaring' };
  readonly #bitmaps = new Map<string, RoaringBitmap32>();
  /** Every tagged chunk id in ascending order; a chunk's position is its ordinal. */
  readonly #chunkIds: Uint32Array;
  /**
   * Each tag's chunk ordinals, kept in JavaScript memory so ranked search need not copy ids out of
   * WASM on every query (about half its time).
   */
  readonly #ordinals = new Map<string, Uint32Array>();
  /** Match counts per chunk ordinal during a ranked search; all zero between searches. */
  readonly #matchCounts: Uint16Array;

  constructor(chunkTags: readonly ChunkTag[]) {
    super();
    const idsBySlug = new Map<string, number[]>();
    for (const { chunkId, slug } of chunkTags) {
      let ids = idsBySlug.get(slug);
      if (!ids) idsBySlug.set(slug, (ids = []));
      ids.push(chunkId);
    }
    for (const [slug, ids] of idsBySlug) {
      const bitmap = new RoaringBitmap32(ids);
      bitmap.runOptimize();
      bitmap.shrinkToFit();
      this.#bitmaps.set(slug, bitmap);
    }
    this.#chunkIds = this.#union([...this.#bitmaps.values()]);
    const ordinalOf = ordinalsOf(this.#chunkIds);
    for (const [slug, bitmap] of this.#bitmaps) {
      this.#ordinals.set(
        slug,
        bitmap.toUint32Array().map((chunkId) => ordinalOf.get(chunkId)!),
      );
    }
    this.tagCount = this.#bitmaps.size;
    this.chunkCount = this.#chunkIds.length;
    this.#matchCounts = new Uint16Array(this.chunkCount);
  }

  protected hasTag(slug: string): boolean {
    return this.#bitmaps.has(slug);
  }

  protected all(tags: readonly string[]): number[] {
    // Intersecting from the smallest bitmap keeps every intermediate result small.
    const [smallest, ...rest] = this.#bitmapsOf(tags).sort((a, b) => a.size - b.size);
    const result = smallest.clone();
    try {
      for (const bitmap of rest) {
        if (result.isEmpty) break;
        result.andInPlace(bitmap);
      }
      return toNumbers(result.toUint32Array());
    } finally {
      result.dispose();
    }
  }

  protected any(tags: readonly string[]): number[] {
    return toNumbers(this.#union(this.#bitmapsOf(tags)));
  }

  protected ranked(tags: readonly string[], options: Required<RankedOptions>): RankedHit[] {
    const counts = this.#matchCounts;
    for (const slug of tags) {
      for (const ordinal of this.#ordinals.get(slug)!) counts[ordinal]++;
    }
    return rankByMatches(counts, this.#chunkIds, tags.length, options);
  }

  dispose(): void {
    for (const bitmap of this.#bitmaps.values()) bitmap.dispose();
    this.#bitmaps.clear();
    this.#ordinals.clear();
  }

  #bitmapsOf(tags: readonly string[]): RoaringBitmap32[] {
    return tags.map((slug) => this.#bitmaps.get(slug)!);
  }

  /** The ids in any of `bitmaps`, in ascending order. */
  #union(bitmaps: RoaringBitmap32[]): Uint32Array {
    const union = RoaringBitmap32.orMany(bitmaps);
    try {
      return union.toUint32Array();
    } finally {
      union.dispose();
    }
  }
}

/** The ids as a plain array; an indexed copy is several times faster than `Array.from` here. */
function toNumbers(ids: Uint32Array): number[] {
  const numbers = new Array<number>(ids.length);
  for (let i = 0; i < ids.length; i++) numbers[i] = ids[i];
  return numbers;
}
