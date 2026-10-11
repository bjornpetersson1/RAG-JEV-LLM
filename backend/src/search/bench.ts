import { describeError } from '../errors.js';
import { percentile } from '../stats.js';
import { measure } from './measure.js';
import { buildBloomIndex, type BloomSettings, type BloomTagIndex } from './bloom-index.js';
import { loadSearchConfig } from './config.js';
import { measureFalsePositives } from './false-positives.js';
import { buildRoaringIndex } from './roaring-index.js';
import { generateSyntheticData, syntheticQueries } from './synthetic.js';
import type { TagIndex } from './tag-index.js';

/** A search must take less than this (median) on the gated implementations. */
const MAX_MEDIAN_MS = 5;
const QUERIES_PER_SIZE = 20;
const QUERY_SIZES = [3, 5];
const ROUNDS = 25;

const MODES = ['searchAll', 'searchAny', 'searchRanked'] as const;

type Mode = (typeof MODES)[number];

interface Implementation {
  name: string;
  index: TagIndex;
  /** Whether the 5 ms limit applies; the bloom variant is measured, not gated. */
  gated: boolean;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

function run(): number {
  const { bloom } = loadSearchConfig(process.env);
  const data = generateSyntheticData();
  const queries = QUERY_SIZES.flatMap((size) =>
    syntheticQueries(data.slugs, { count: QUERIES_PER_SIZE, size, seed: size }),
  );
  console.log(
    `${data.chunkTags.length} synthetic chunk tags, ` +
      `${queries.length} queries of ${QUERY_SIZES.join(' and ')} tags, ${ROUNDS} rounds`,
  );
  const implementations: Implementation[] = [];
  /** Builds and lists an index, printing its size, build time and memory kept. */
  const add = <T extends TagIndex>(name: string, gated: boolean, build: () => T): T => {
    const { result: index, elapsedMs, memoryBytes } = measure(build);
    console.log(
      `${name}: ${index.chunkCount} chunks, ${index.tagCount} tags, ` +
        `built in ${elapsedMs} ms, ${formatMegabytes(memoryBytes)}`,
    );
    implementations.push({ name, index, gated });
    return index;
  };
  try {
    const roaring = add('roaring', true, () => buildRoaringIndex(data.chunkTags));
    add('bloom verified', false, () => buildBloomIndex(data.chunkTags, { ...bloom, verify: true }));
    const unverified = add('bloom unverified', false, () =>
      buildBloomIndex(data.chunkTags, { ...bloom, verify: false }),
    );

    let failed = false;
    for (const { name, index, gated } of implementations) {
      console.log(`\n${name}:`);
      for (const mode of MODES) {
        const times = timeSearches(index, queries, mode).sort((a, b) => a - b);
        const median = percentile(times, 0.5);
        const tooSlow = gated && median >= MAX_MEDIAN_MS;
        failed ||= tooSlow;
        console.log(
          `  ${mode.padEnd(12)} median ${median.toFixed(3)} ms, p95 ${percentile(times, 0.95).toFixed(3)} ms` +
            (tooSlow ? `  FAIL (limit ${MAX_MEDIAN_MS} ms)` : ''),
        );
      }
    }
    printFalsePositives(roaring, unverified, queries, bloom);
    return failed ? 1 : 0;
  } finally {
    for (const { index } of implementations) index.dispose();
  }
}

function printFalsePositives(
  exact: TagIndex,
  unverified: BloomTagIndex,
  queries: string[][],
  { bits, hashes }: BloomSettings,
): void {
  const measured = measureFalsePositives(exact, unverified, queries);
  console.log(
    `\nbloom false positives (${bits} bits, ${hashes} hashes): theoretical ` +
      `${formatPercent(unverified.falsePositiveRate)} per tag test, ` +
      `measured ${formatPercent(measured.perTagTest)}`,
  );
  for (const mode of MODES) {
    console.log(
      `  ${mode.padEnd(12)} ${formatPercent(measured[mode])} of the unverified hits are wrong`,
    );
  }
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

function formatPercent(share: number): string {
  return `${(share * 100).toFixed(3)} %`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
