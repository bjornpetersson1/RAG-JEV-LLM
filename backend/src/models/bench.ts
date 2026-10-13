// `npm run models:bench -- --dtype int8|fp32` (E8-2): times the local models on the demo machine.
// Loads bge-m3 and bge-reranker-v2-m3 in one precision, embeds 100 real chunks and scores 100
// (query, chunk) pairs, and prints one Markdown table row. Run once per precision, in separate
// processes, so the memory figures do not mix. The first run downloads the models.

import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { BGE_M3_MODEL, BGE_RERANKER } from './catalog.js';
import { formatSeconds, parseDtypeArg } from './bench-args.js';
import { loadLocalModelConfig, type ModelDtype } from './config.js';
import { BENCH_INSTRUCTION, loadSamplePassages } from './passages.js';
import { inBatches, loadCrossEncoder, loadTextEncoder } from './runtime.js';

const SAMPLE_SIZE = 100;

try {
  const dtype = parseDtypeArg();
  await withDatabase((db) => run(dtype, loadSamplePassages(db, SAMPLE_SIZE)));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(dtype: ModelDtype, passages: string[]): Promise<void> {
  // The configured batch sizes and cache, so the bench times what the embedder and reranker run.
  const { cacheDir, batchSize } = loadLocalModelConfig(process.env, 'EMBEDDER');
  const rerankBatchSize = loadLocalModelConfig(process.env, 'RERANKER').batchSize;

  let started = performance.now();
  const encode = await loadTextEncoder(BGE_M3_MODEL, dtype, cacheDir);
  const embedderLoadMs = elapsedMs(started);
  started = performance.now();
  for (const batch of inBatches(passages, batchSize)) await encode(batch);
  const embedMs = elapsedMs(started);

  started = performance.now();
  const score = await loadCrossEncoder(BGE_RERANKER, dtype, cacheDir);
  const rerankerLoadMs = elapsedMs(started);
  started = performance.now();
  for (const batch of inBatches(passages, rerankBatchSize)) {
    await score(batch.map((passage) => ({ query: BENCH_INSTRUCTION, passage })));
  }
  const scoreMs = elapsedMs(started);
  // The process's peak, including activations freed after each batch; in kilobytes.
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;

  console.log(
    `| dtype | bge-m3 load | embed ${SAMPLE_SIZE} chunks | reranker load | score ${SAMPLE_SIZE} pairs | peak RSS |`,
  );
  console.log('| --- | --- | --- | --- | --- | --- |');
  console.log(
    `| ${dtype} | ${formatSeconds(embedderLoadMs, 1)} | ${formatSeconds(embedMs, 1)} | ${formatSeconds(rerankerLoadMs, 1)} | ` +
      `${formatSeconds(scoreMs, 1)} | ${(peakRssBytes / 1024 ** 3).toFixed(2)} GB |`,
  );
}
