/** The value at `share` of `sorted`, which must be in ascending order, e.g. 0.5 for the median. */
export function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}
