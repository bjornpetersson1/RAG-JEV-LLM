import { createHash } from 'node:crypto';
import {
  BaseTagIndex,
  ordinalsOf,
  rankByMatches,
  type BuildTagIndex,
  type ChunkTag,
  type RankedHit,
  type RankedOptions,
  type TagIndex,
} from './tag-index.js';

export interface BloomSettings {
  /** Bits in each chunk's signature. */
  bits: number;
  /** Signature bits set per tag. */
  hashes: number;
  /** Check every candidate against the chunk's exact tags, removing false positives. */
  verify: boolean;
}

export interface BloomTagIndex extends TagIndex {
  /** The chance that one tag test on a chunk without the tag still matches, from the settings. */
  readonly falsePositiveRate: number;
}

/**
 * The bloom filter variant: every chunk gets a signature of `bits` bits with `hashes` bits set per
 * tag. The signatures are stored bit-sliced, one bitset column per signature bit across all chunks,
 * so a tag's candidates are the AND of its `hashes` columns.
 */
export function buildBloomIndex(
  chunkTags: readonly ChunkTag[],
  settings: BloomSettings,
): BloomTagIndex {
  return new BitSlicedBloomIndex(chunkTags, settings);
}

/** {@link buildBloomIndex} with fixed settings. */
export function bloomIndexBuilder(settings: BloomSettings): BuildTagIndex {
  return (chunkTags) => buildBloomIndex(chunkTags, settings);
}

class BitSlicedBloomIndex extends BaseTagIndex implements BloomTagIndex {
  readonly chunkCount: number;
  readonly tagCount: number;
  readonly falsePositiveRate: number;
  readonly description;
  readonly #verify: boolean;
  /** Every tagged chunk id in ascending order; a chunk's position is its ordinal. */
  readonly #chunkIds: Uint32Array;
  /** One bitset over chunk ordinals per signature bit. */
  readonly #columns: Uint32Array[];
  /** A number per known tag slug; the arrays below are indexed by it. */
  readonly #tagNumbers = new Map<string, number>();
  /** The signature bits of each tag. */
  readonly #positions: Uint32Array[] = [];
  /**
   * The exact tags per chunk, for verification: chunk ordinal `o` has the tag numbers
   * `#tagLists[#tagListStarts[o]]` up to `#tagListStarts[o + 1]`.
   */
  readonly #tagLists: Uint16Array;
  readonly #tagListStarts: Uint32Array;
  /** Reused per search: candidate chunks, the query's tags, and match counts per chunk. */
  readonly #candidates: Uint32Array;
  readonly #queryTags: Uint8Array;
  readonly #matchCounts: Uint16Array;

  constructor(chunkTags: readonly ChunkTag[], settings: BloomSettings) {
    super();
    this.#verify = settings.verify;
    this.#chunkIds = Uint32Array.from(new Set(chunkTags.map((tag) => tag.chunkId))).sort();
    this.chunkCount = this.#chunkIds.length;
    for (const { slug } of chunkTags) {
      if (this.#tagNumbers.has(slug)) continue;
      this.#tagNumbers.set(slug, this.#tagNumbers.size);
      this.#positions.push(signaturePositions(slug, settings));
    }
    this.tagCount = this.#tagNumbers.size;

    if (this.tagCount > MAX_TAGS) {
      throw new RangeError(
        `The bloom index supports at most ${MAX_TAGS} tags, got ${this.tagCount}`,
      );
    }

    // Repeated chunk–tag pairs count once, as they do in the other indexes.
    const ordinalOf = ordinalsOf(this.#chunkIds);
    const seen = new Set<number>();
    const pairs: { ordinal: number; tagNumber: number }[] = [];
    for (const { chunkId, slug } of chunkTags) {
      const ordinal = ordinalOf.get(chunkId)!;
      const tagNumber = this.#tagNumbers.get(slug)!;
      const key = ordinal * this.tagCount + tagNumber;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ ordinal, tagNumber });
    }

    const words = Math.ceil(this.chunkCount / 32);
    this.#columns = Array.from({ length: settings.bits }, () => new Uint32Array(words));
    for (const { ordinal, tagNumber } of pairs) {
      for (const position of this.#positions[tagNumber]) {
        this.#columns[position][ordinal >>> 5] |= 1 << (ordinal & 31);
      }
    }
    // Only verification reads the exact tags, so an unverified index does not keep them.
    const exact = this.#verify ? exactTagLists(pairs, this.chunkCount) : undefined;
    this.#tagLists = exact?.tagLists ?? new Uint16Array(0);
    this.#tagListStarts = exact?.starts ?? new Uint32Array(0);

    const meanTags = this.chunkCount > 0 ? pairs.length / this.chunkCount : 0;
    this.falsePositiveRate = theoreticalFalsePositiveRate(settings, meanTags);
    this.description = {
      implementation: 'bloom',
      ...settings,
      falsePositiveRate: this.falsePositiveRate,
    };
    this.#candidates = new Uint32Array(words);
    this.#queryTags = new Uint8Array(this.#verify ? this.tagCount : 0);
    this.#matchCounts = new Uint16Array(this.chunkCount);
  }

  protected hasTag(slug: string): boolean {
    return this.#tagNumbers.has(slug);
  }

  protected all(tags: readonly string[]): number[] {
    // A chunk is a candidate for every tag when its signature has the bits of all of them.
    const positions = new Set(this.#tagNumbersOf(tags).flatMap((n) => [...this.#positions[n]]));
    this.#setCandidates([...positions]);
    return this.#collect(tags, (matched) => matched === tags.length);
  }

  protected any(tags: readonly string[]): number[] {
    this.#setCandidatesToUnion(tags);
    return this.#collect(tags, (matched) => matched > 0);
  }

  protected ranked(tags: readonly string[], options: Required<RankedOptions>): RankedHit[] {
    const counts = this.#matchCounts;
    if (this.#verify) {
      // One pass over every candidate, counting its exact matches once.
      this.#setCandidatesToUnion(tags);
      this.#withQueryTags(tags, () =>
        this.#forEachCandidate((ordinal) => {
          counts[ordinal] = this.#matchedQueryTags(ordinal);
        }),
      );
    } else {
      // Without verification a chunk's count is the number of tags whose bits it has.
      for (const tagNumber of this.#tagNumbersOf(tags)) {
        this.#setCandidates([...this.#positions[tagNumber]]);
        this.#forEachCandidate((ordinal) => counts[ordinal]++);
      }
    }
    return rankByMatches(counts, this.#chunkIds, tags.length, options);
  }

  dispose(): void {}

  #tagNumbersOf(tags: readonly string[]): number[] {
    return tags.map((slug) => this.#tagNumbers.get(slug)!);
  }

  /** Sets the candidates to the chunks whose signature has every one of `positions`. */
  #setCandidates(positions: readonly number[]): void {
    const candidates = this.#candidates;
    candidates.set(this.#columns[positions[0]]);
    for (let p = 1; p < positions.length; p++) {
      const column = this.#columns[positions[p]];
      for (let word = 0; word < candidates.length; word++) candidates[word] &= column[word];
    }
  }

  /** Sets the candidates to the chunks that are candidates for any of `tags`. */
  #setCandidatesToUnion(tags: readonly string[]): void {
    const candidates = this.#candidates;
    candidates.fill(0);
    for (const tagNumber of this.#tagNumbersOf(tags)) {
      const columns = Array.from(this.#positions[tagNumber], (position) => this.#columns[position]);
      for (let word = 0; word < candidates.length; word++) {
        let bits = columns[0][word];
        for (let c = 1; c < columns.length && bits !== 0; c++) bits &= columns[c][word];
        candidates[word] |= bits;
      }
    }
  }

  /** The ids of the candidates; when verifying, only those whose exact match count `accepts`. */
  #collect(tags: readonly string[], accepts: (matched: number) => boolean): number[] {
    const chunkIds: number[] = [];
    if (!this.#verify) {
      this.#forEachCandidate((ordinal) => chunkIds.push(this.#chunkIds[ordinal]));
      return chunkIds;
    }
    this.#withQueryTags(tags, () =>
      this.#forEachCandidate((ordinal) => {
        if (accepts(this.#matchedQueryTags(ordinal))) chunkIds.push(this.#chunkIds[ordinal]);
      }),
    );
    return chunkIds;
  }

  /** Runs `work` with the query's tags marked in `#queryTags`, then clears them. */
  #withQueryTags(tags: readonly string[], work: () => void): void {
    const tagNumbers = this.#tagNumbersOf(tags);
    for (const tagNumber of tagNumbers) this.#queryTags[tagNumber] = 1;
    try {
      work();
    } finally {
      for (const tagNumber of tagNumbers) this.#queryTags[tagNumber] = 0;
    }
  }

  /** How many of the marked query tags the chunk has, from its exact tag list. */
  #matchedQueryTags(ordinal: number): number {
    let matched = 0;
    for (let i = this.#tagListStarts[ordinal]; i < this.#tagListStarts[ordinal + 1]; i++) {
      matched += this.#queryTags[this.#tagLists[i]];
    }
    return matched;
  }

  /** Calls `visit` with the ordinal of every candidate, in ascending order. */
  #forEachCandidate(visit: (ordinal: number) => void): void {
    const candidates = this.#candidates;
    for (let word = 0; word < candidates.length; word++) {
      let bits = candidates[word];
      while (bits !== 0) {
        const lowest = bits & -bits;
        visit(word * 32 + 31 - Math.clz32(lowest));
        bits ^= lowest;
      }
    }
  }
}

/** Tag numbers are stored as 16-bit values in the exact tag lists. */
const MAX_TAGS = 0xffff + 1;

/** Each chunk's tag numbers, as one flat list with a start offset per chunk ordinal. */
function exactTagLists(
  pairs: readonly { ordinal: number; tagNumber: number }[],
  chunkCount: number,
): { tagLists: Uint16Array; starts: Uint32Array } {
  const starts = new Uint32Array(chunkCount + 1);
  for (const { ordinal } of pairs) starts[ordinal + 1]++;
  for (let ordinal = 0; ordinal < chunkCount; ordinal++) starts[ordinal + 1] += starts[ordinal];
  const tagLists = new Uint16Array(pairs.length);
  const next = starts.slice(0, chunkCount);
  for (const { ordinal, tagNumber } of pairs) tagLists[next[ordinal]++] = tagNumber;
  return { tagLists, starts };
}

/** (1 − e^(−k·n/m))^k for m bits, k hashes and n tags per chunk on average. */
export function theoreticalFalsePositiveRate(
  { bits, hashes }: Pick<BloomSettings, 'bits' | 'hashes'>,
  meanTagsPerChunk: number,
): number {
  return (1 - Math.exp((-hashes * meanTagsPerChunk) / bits)) ** hashes;
}

/**
 * The `hashes` signature bits of `slug`, each from its own 32-bit word of SHA-256. Double hashing
 * with FNV-1a gave similar slugs overlapping bit patterns: about 30 times the theoretical false
 * positive rate on the synthetic data, against about 2 times with this.
 */
function signaturePositions(slug: string, { bits, hashes }: BloomSettings): Uint32Array {
  const wordsPerDigest = 8;
  const digests: Buffer[] = [];
  return Uint32Array.from({ length: hashes }, (_, i) => {
    const round = Math.floor(i / wordsPerDigest);
    digests[round] ??= createHash('sha256').update(`${slug}#${round}`).digest();
    return digests[round].readUInt32LE((i % wordsPerDigest) * 4) % bits;
  });
}
