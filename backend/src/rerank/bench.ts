// `npm run bench:rerank -- --dtype int8|fp32` (E8-3): times the BGE reranker on the demo machine.
// Reranks 30 and 50 real chunks against a Swedish instruction, 5 runs each, and prints the median
// per size and the model load time separately. Run once per precision.

import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { formatSeconds, parseDtypeArg } from '../models/bench-args.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { BENCH_INSTRUCTION, loadSampleChunks } from '../models/passages.js';
import { mean, percentile } from '../stats.js';
import { createBgeReranker, loadBgeRerankerConfig } from './bge-reranker.js';

const SIZES = [30, 50];
const RUNS = 5;

try {
  const dtype = parseDtypeArg();
  const config = { ...loadBgeRerankerConfig(process.env), dtype };
  const largest = Math.max(...SIZES);
  const chunks = await withDatabase((db) => loadSampleChunks(db, largest));
  if (chunks.length < largest) {
    throw new Error(`The bench needs ${largest} chunks; the database has ${chunks.length}`);
  }
  const reranker = createBgeReranker(config, SILENT_LOGGER);

  // The first rerank loads the model; one chunk keeps the scoring part of it small.
  const loadStarted = performance.now();
  await reranker.rerank(BENCH_INSTRUCTION, chunks.slice(0, 1), 1);
  const loadMs = elapsedMs(loadStarted);

  console.log(`| dtype | chunks | median of ${RUNS} runs | per chunk |`);
  console.log('| --- | --- | --- | --- |');
  for (const size of SIZES) {
    const sample = chunks.slice(0, size);
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      times.push((await reranker.rerank(BENCH_INSTRUCTION, sample, size)).stats.elapsedMs);
    }
    const median = percentile(
      times.sort((a, b) => a - b),
      0.5,
    );
    console.log(
      `| ${dtype} | ${size} | ${formatSeconds(median, 2)} | ${formatSeconds(median / size, 2)} |`,
    );
  }
  const averageChars = Math.round(mean(chunks.map((chunk) => chunk.text.length)));
  console.log(
    `\nModel load (and one pair): ${formatSeconds(loadMs, 2)}. Chunks: ${chunks.length} spread over the corpus, ` +
      `${averageChars} characters on average. Batch size ${config.batchSize}.`,
  );
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
