// `npm run models:bench -- --dtype int8|fp32` (E8-2): times the local models on the demo machine.
// Loads bge-m3 and bge-reranker-v2-m3 in one precision, embeds 100 real chunks and scores 100
// (query, chunk) pairs, and prints one Markdown table row. Run once per precision, in separate
// processes, so the memory figures do not mix. The first run downloads the models.

import { parseArgs } from 'node:util';
import { withDatabase } from '../db/with-database.js';
import { isOneOf } from '../env.js';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { BGE_M3_MODEL, BGE_RERANKER_MODEL } from './catalog.js';
import { loadLocalModelConfig, MODEL_DTYPES, type ModelDtype } from './config.js';
import { loadSamplePassages } from './passages.js';
import { inBatches, loadCrossEncoder, loadTextEncoder } from './runtime.js';

const SAMPLE_SIZE = 100;
const RERANK_MAX_TOKENS = 1024;
const QUERY =
  'Anställningsavtal för en säljare med sex månaders provanställning och konkurrensklausul';

try {
  const { values } = parseArgs({ options: { dtype: { type: 'string', default: 'int8' } } });
  const { dtype } = values;
  if (!isOneOf(MODEL_DTYPES, dtype))
    throw new Error(`--dtype must be ${MODEL_DTYPES.join(' or ')}`);
  await withDatabase((db) => run(dtype, loadSamplePassages(db, SAMPLE_SIZE)));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(dtype: ModelDtype, passages: string[]): Promise<void> {
  // The configured batch size and cache, so the bench times what the embedder runs.
  const { cacheDir, batchSize } = loadLocalModelConfig(process.env, 'EMBEDDER');

  let started = performance.now();
  const encode = await loadTextEncoder(BGE_M3_MODEL, dtype, cacheDir);
  const embedderLoadMs = elapsedMs(started);
  started = performance.now();
  for (const batch of inBatches(passages, batchSize)) await encode(batch);
  const embedMs = elapsedMs(started);

  started = performance.now();
  const score = await loadCrossEncoder(BGE_RERANKER_MODEL, dtype, cacheDir);
  const rerankerLoadMs = elapsedMs(started);
  started = performance.now();
  for (const batch of inBatches(passages, batchSize)) {
    await score(
      batch.map((passage) => ({ query: QUERY, passage })),
      RERANK_MAX_TOKENS,
    );
  }
  const scoreMs = elapsedMs(started);
  // The process's peak, including activations freed after each batch; in kilobytes.
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;

  console.log(
    '| dtype | bge-m3 load | embed 100 chunks | reranker load | score 100 pairs | peak RSS |',
  );
  console.log('| --- | --- | --- | --- | --- | --- |');
  console.log(
    `| ${dtype} | ${seconds(embedderLoadMs)} | ${seconds(embedMs)} | ${seconds(rerankerLoadMs)} | ` +
      `${seconds(scoreMs)} | ${(peakRssBytes / 1024 ** 3).toFixed(2)} GB |`,
  );
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
