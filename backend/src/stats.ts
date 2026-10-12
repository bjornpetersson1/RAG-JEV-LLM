/** The value at `share` of `sorted`, which must be in ascending order, e.g. 0.5 for the median. */
export function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The arithmetic mean; 0 for no values. */
export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export interface Latency {
  median: number;
  p90: number;
}

/** The median and p90 of `times`; 0 for no times. */
export function latencyOf(times: readonly number[]): Latency {
  if (times.length === 0) return { median: 0, p90: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) };
}
