import type { TagIndex } from './tag-index.js';

export interface FalsePositiveShares {
  /**
   * Share of single-tag tests on chunks without the tag that still match: the rate a bloom filter's
   * theory predicts.
   */
  perTagTest: number;
  /** Share of the chunks AND returned that do not have every tag. */
  searchAll: number;
  /** Share of the chunks OR returned that have none of the tags. */
  searchAny: number;
  /** Share of the ranked hits (all of them, no limit) whose match count is too high. */
  searchRanked: number;
}

/**
 * How often `approximate` (e.g. an unverified bloom index) returns a wrong hit, measured against
 * `exact` over the same queries.
 */
export function measureFalsePositives(
  exact: TagIndex,
  approximate: TagIndex,
  queries: readonly string[][],
): FalsePositiveShares {
  const share = (wrong: number, total: number) => (total > 0 ? wrong / total : 0);
  const totals = { tag: [0, 0], all: [0, 0], any: [0, 0], ranked: [0, 0] };
  for (const slug of new Set(queries.flat())) {
    const withTag = new Set(exact.searchAny([slug]));
    totals.tag[0] += approximate
      .searchAny([slug])
      .filter((chunkId) => !withTag.has(chunkId)).length;
    totals.tag[1] += exact.chunkCount - withTag.size;
  }
  for (const tags of queries) {
    for (const [mode, search] of [
      ['all', (index: TagIndex) => index.searchAll(tags)],
      ['any', (index: TagIndex) => index.searchAny(tags)],
    ] as const) {
      const truth = new Set(search(exact));
      const found = search(approximate);
      totals[mode][0] += found.filter((chunkId) => !truth.has(chunkId)).length;
      totals[mode][1] += found.length;
    }
    const limit = Math.max(1, approximate.chunkCount);
    const trueMatches = new Map(
      exact.searchRanked(tags, { limit }).map((hit) => [hit.chunkId, hit.matches]),
    );
    const ranked = approximate.searchRanked(tags, { limit });
    totals.ranked[0] += ranked.filter(
      (hit) => hit.matches > (trueMatches.get(hit.chunkId) ?? 0),
    ).length;
    totals.ranked[1] += ranked.length;
  }
  return {
    perTagTest: share(totals.tag[0], totals.tag[1]),
    searchAll: share(totals.all[0], totals.all[1]),
    searchAny: share(totals.any[0], totals.any[1]),
    searchRanked: share(totals.ranked[0], totals.ranked[1]),
  };
}
