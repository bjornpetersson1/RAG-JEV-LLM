import type { ChunkTag } from './tag-index.js';

export interface SyntheticOptions {
  /** Number of chunks, with ids 1 to `chunks`; default 100,000. */
  chunks?: number;
  /** Number of tags; default 183, the size of the E3-1 vocabulary. */
  tags?: number;
  /** Fewest and most tags per chunk; default 3 and 8, as the tagger (E3-2) gives. */
  minTagsPerChunk?: number;
  maxTagsPerChunk?: number;
  /** Zipf exponent of tag popularity: 0 is uniform, higher makes a few tags broad; default 1. */
  skew?: number;
  seed?: number;
}

export interface SyntheticData {
  /** Tag slugs, most popular first. */
  slugs: string[];
  chunkTags: ChunkTag[];
}

const DEFAULT_SEED = 42;

/** Chunks with random tags for benchmarks; the same options always give the same data. */
export function generateSyntheticData(options: SyntheticOptions = {}): SyntheticData {
  const {
    chunks = 100_000,
    tags = 183,
    minTagsPerChunk = 3,
    maxTagsPerChunk = 8,
    skew = 1,
    seed = DEFAULT_SEED,
  } = options;
  if (!(minTagsPerChunk >= 1 && minTagsPerChunk <= maxTagsPerChunk && maxTagsPerChunk <= tags)) {
    throw new RangeError(
      `Invalid tags per chunk ${minTagsPerChunk}–${maxTagsPerChunk} for ${tags} tags`,
    );
  }
  const random = mulberry32(seed);
  const slugs = Array.from({ length: tags }, (_, rank) => `tag-${String(rank).padStart(3, '0')}`);
  const pickTag = zipfSampler(tags, skew, random);
  const chunkTags: ChunkTag[] = [];
  for (let chunkId = 1; chunkId <= chunks; chunkId++) {
    const count = minTagsPerChunk + Math.floor(random() * (maxTagsPerChunk - minTagsPerChunk + 1));
    for (const rank of distinct(count, pickTag)) chunkTags.push({ chunkId, slug: slugs[rank] });
  }
  return { slugs, chunkTags };
}

/** `count` queries of `size` distinct tags, drawn with the same popularity as the chunks' tags. */
export function syntheticQueries(
  slugs: readonly string[],
  { count, size, seed = DEFAULT_SEED }: { count: number; size: number; seed?: number },
): string[][] {
  if (size > slugs.length) {
    throw new RangeError(`Invalid query size ${size} for ${slugs.length} tags`);
  }
  // The default skew, as the chunks' tags have.
  const pickTag = zipfSampler(slugs.length, 1, mulberry32(seed));
  return Array.from({ length: count }, () => distinct(size, pickTag).map((rank) => slugs[rank]));
}

function distinct(count: number, pick: () => number): number[] {
  const picked = new Set<number>();
  while (picked.size < count) picked.add(pick());
  return [...picked];
}

/** Draws ranks 0 to n − 1 with probability proportional to 1 / (rank + 1)^skew. */
function zipfSampler(n: number, skew: number, random: () => number): () => number {
  const cumulative: number[] = [];
  let total = 0;
  for (let rank = 0; rank < n; rank++) cumulative.push((total += 1 / (rank + 1) ** skew));
  return () => {
    const target = random() * total;
    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid] > target) high = mid;
      else low = mid + 1;
    }
    return low;
  };
}

/** A small seeded pseudo-random generator returning numbers in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
