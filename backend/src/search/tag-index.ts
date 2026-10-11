/** One tag on one chunk, as stored in `chunk_tags` (the tag by its vocabulary slug). */
export interface ChunkTag {
  chunkId: number;
  slug: string;
}

/** A chunk found by a ranked search, with how many of the query's tags it has. */
export interface RankedHit {
  chunkId: number;
  matches: number;
}

export interface RankedOptions {
  /** Only chunks with at least this many of the query's tags; default 1. */
  minMatches?: number;
  /** At most this many hits; default {@link DEFAULT_RANKED_LIMIT}. */
  limit?: number;
}

const DEFAULT_RANKED_LIMIT = 200;

/**
 * Search over chunk tags, shared by the inverted index (E4-1) and the bloom filter variant (E4-2).
 * Unknown tags match nothing, a repeated tag counts once, and an empty query finds nothing.
 */
export interface TagIndex {
  /** Number of distinct chunks with at least one tag. */
  readonly chunkCount: number;
  /** Number of distinct tags on at least one chunk. */
  readonly tagCount: number;
  /** The implementation and its settings, for logs and the bench. */
  readonly description: IndexDescription;
  /** Chunks with every tag (AND), in ascending id order. */
  searchAll(tags: readonly string[]): number[];
  /** Chunks with at least one tag (OR), in ascending id order. */
  searchAny(tags: readonly string[]): number[];
  /** Chunks by number of matching tags (most first, then ascending id), cut to the limit. */
  searchRanked(tags: readonly string[], options?: RankedOptions): RankedHit[];
  /** Frees memory the index holds outside the JavaScript heap. */
  dispose(): void;
}

export interface IndexDescription {
  implementation: string;
  [setting: string]: string | number | boolean;
}

/** Builds a {@link TagIndex} from every chunk–tag pair. */
export type BuildTagIndex = (chunkTags: readonly ChunkTag[]) => TagIndex;

/**
 * Applies the query rules every {@link TagIndex} shares: repeated tags count once, unknown tags
 * match nothing, an empty query finds nothing, and ranked options are validated. Subclasses search
 * only with distinct known tags, at least one.
 */
export abstract class BaseTagIndex implements TagIndex {
  abstract readonly chunkCount: number;
  abstract readonly tagCount: number;
  abstract readonly description: IndexDescription;

  protected abstract hasTag(slug: string): boolean;
  protected abstract all(tags: readonly string[]): number[];
  protected abstract any(tags: readonly string[]): number[];
  protected abstract ranked(tags: readonly string[], options: Required<RankedOptions>): RankedHit[];
  abstract dispose(): void;

  searchAll(tags: readonly string[]): number[] {
    const distinct = [...new Set(tags)];
    if (distinct.length === 0 || !distinct.every((slug) => this.hasTag(slug))) return [];
    return this.all(distinct);
  }

  searchAny(tags: readonly string[]): number[] {
    const known = this.#knownTags(tags);
    return known.length > 0 ? this.any(known) : [];
  }

  searchRanked(tags: readonly string[], options: RankedOptions = {}): RankedHit[] {
    const resolved = resolveRankedOptions(options);
    const known = this.#knownTags(tags);
    return known.length > 0 ? this.ranked(known, resolved) : [];
  }

  #knownTags(tags: readonly string[]): string[] {
    return [...new Set(tags)].filter((slug) => this.hasTag(slug));
  }
}

class EmptyTagIndex extends BaseTagIndex {
  readonly chunkCount = 0;
  readonly tagCount = 0;
  readonly description = { implementation: 'empty' };
  protected hasTag = () => false;
  protected all = () => [];
  protected any = () => [];
  protected ranked = () => [];
  dispose(): void {}
}

/** An index without chunks, for a server with no tagged data yet. */
export const EMPTY_TAG_INDEX: TagIndex = Object.freeze(new EmptyTagIndex());

function resolveRankedOptions({
  minMatches = 1,
  limit = DEFAULT_RANKED_LIMIT,
}: RankedOptions): Required<RankedOptions> {
  if (!isPositiveInteger(minMatches)) throw invalidOption('minMatches', minMatches);
  if (!isPositiveInteger(limit)) throw invalidOption('limit', limit);
  return { minMatches, limit };
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function invalidOption(name: string, value: number): RangeError {
  return new RangeError(`Invalid ${name} ${value}: expected a positive integer`);
}

/**
 * Each chunk id's ordinal, its position in `chunkIds` (ascending). Implementations number chunks
 * densely so per-chunk arrays stay as large as the corpus, however high re-chunking pushes the ids.
 */
export function ordinalsOf(chunkIds: Uint32Array): Map<number, number> {
  const ordinals = new Map<number, number>();
  for (let ordinal = 0; ordinal < chunkIds.length; ordinal++)
    ordinals.set(chunkIds[ordinal], ordinal);
  return ordinals;
}

/**
 * Ranks chunks by their match counts: most matches first, then ascending id. Chunks are numbered
 * densely, so `matchCounts[ordinal]` is how many of the `tagCount` query tags the chunk
 * `chunkIds[ordinal]` has, and `chunkIds` is in ascending order. Resets every count to zero.
 */
export function rankByMatches(
  matchCounts: Uint16Array,
  chunkIds: Uint32Array,
  tagCount: number,
  { minMatches, limit }: Required<RankedOptions>,
): RankedHit[] {
  // First count the chunks per match count, so only the hits that make the cut are collected.
  const perCount = new Array<number>(tagCount + 1).fill(0);
  for (let ordinal = 0; ordinal < matchCounts.length; ordinal++) perCount[matchCounts[ordinal]]++;
  const quota = new Array<number>(tagCount + 1).fill(0);
  let remaining = limit;
  for (let matches = tagCount; matches >= minMatches && remaining > 0; matches--) {
    quota[matches] = Math.min(perCount[matches], remaining);
    remaining -= quota[matches];
  }
  // One bucket per match count keeps ascending id order within a count without sorting.
  const buckets: number[][] = Array.from({ length: tagCount + 1 }, () => []);
  for (let ordinal = 0; ordinal < matchCounts.length; ordinal++) {
    const matches = matchCounts[ordinal];
    if (matches === 0) continue;
    if (buckets[matches].length < quota[matches]) buckets[matches].push(chunkIds[ordinal]);
    matchCounts[ordinal] = 0;
  }
  const hits: RankedHit[] = [];
  for (let matches = tagCount; matches >= minMatches; matches--) {
    for (const chunkId of buckets[matches]) hits.push({ chunkId, matches });
  }
  return hits;
}
