import { describeError } from '../errors.js';
import { measure } from './measure.js';
import { buildRoaringIndex } from './roaring-index.js';
import { generateSyntheticData, syntheticQueries } from './synthetic.js';
import type { BuildTagIndex, TagIndex } from './tag-index.js';

/** A search must take less than this (median). */
const MAX_MEDIAN_MS = 5;
const QUERIES_PER_SIZE = 20;
const QUERY_SIZES = [3, 5];
const ROUNDS = 25;

const IMPLEMENTATIONS: { name: string; build: BuildTagIndex }[] = [
  { name: 'roaring', build: buildRoaringIndex },
];

const MODES = ['searchAll', 'searchAny', 'searchRanked'] as const;

type Mode = (typeof MODES)[number];

try {
  process.exitCode = run();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

function run(): number {
  const data = generateSyntheticData();
  const queries = QUERY_SIZES.flatMap((size) =>
    syntheticQueries(data.slugs, { count: QUERIES_PER_SIZE, size, seed: size }),
  );
  console.log(
    `${data.chunkTags.length} synthetic chunk tags, ` +
      `${queries.length} queries of ${QUERY_SIZES.join(' and ')} tags, ${ROUNDS} rounds`,
  );
  let failed = false;
  for (const { name, build } of IMPLEMENTATIONS) {
    const { result: index, elapsedMs, memoryBytes } = measure(() => build(data.chunkTags));
    console.log(
      `\n${name}: ${index.chunkCount} chunks, ${index.tagCount} tags, ` +
        `built in ${elapsedMs} ms, ${formatMegabytes(memoryBytes)}`,
    );
    try {
      for (const mode of MODES) {
        const times = timeSearches(index, queries, mode).sort((a, b) => a - b);
        const median = percentile(times, 0.5);
        const tooSlow = median >= MAX_MEDIAN_MS;
        failed ||= tooSlow;
        console.log(
          `  ${mode.padEnd(12)} median ${median.toFixed(3)} ms, p95 ${percentile(times, 0.95).toFixed(3)} ms` +
            (tooSlow ? `  FAIL (limit ${MAX_MEDIAN_MS} ms)` : ''),
        );
      }
    } finally {
      index.dispose();
    }
  }
  return failed ? 1 : 0;
}

/** Times every query in every round, after one warm-up pass. */
function timeSearches(index: TagIndex, queries: string[][], mode: Mode): number[] {
  for (const tags of queries) index[mode](tags);
  const times: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    for (const tags of queries) {
      const start = performance.now();
      index[mode](tags);
      times.push(performance.now() - start);
    }
  }
  return times;
}

/** The value at `share` of `sorted`, which must be in ascending order. */
function percentile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
