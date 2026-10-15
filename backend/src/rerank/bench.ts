// `npm run bench:rerank -- [--reranker bge|minilm] [--dtype int8|fp32]` (E8-3, E7-5): times a local
// reranker on the demo machine. Reranks 30 and 50 real chunks against a Swedish instruction, 5 runs
// each, and prints the median per size and the model load time separately. Run once per reranker
// and precision.

import { parseArgs } from 'node:util';
import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { checkDtype, formatSeconds } from '../models/bench-args.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { BENCH_INSTRUCTION, loadSampleChunks } from '../models/passages.js';
import { latencyOf, mean } from '../stats.js';
import type { ModelDtype } from '../models/config.js';
import {
  createCrossEncoderReranker,
  loadCrossEncoderRerankerConfig,
} from './cross-encoder-reranker.js';
import { localCrossEncoders } from './factory.js';
import { minilmReranker } from './minilm-reranker.js';
import type { CrossEncoderSpec } from './types.js';

const SIZES = [30, 50];
const RUNS = 5;

try {
  const { spec, dtype } = parseRerankBenchArgs(process.argv.slice(2));
  const config = { ...loadCrossEncoderRerankerConfig(process.env, spec.name), dtype };
  const largest = Math.max(...SIZES);
  const chunks = await withDatabase((db) => loadSampleChunks(db, largest));
  if (chunks.length < largest) {
    throw new Error(`The bench needs ${largest} chunks; the database has ${chunks.length}`);
  }
  const reranker = createCrossEncoderReranker(spec, config, SILENT_LOGGER);

  console.log(`| reranker | dtype | chunks | median of ${RUNS} runs | per chunk |`);
  console.log('| --- | --- | --- | --- | --- |');
  // The first rerank loads the model; one chunk keeps the scoring part of it small. A precision
  // whose ONNX file is missing or does not load gets a row saying so.
  const loadStarted = performance.now();
  try {
    await reranker.rerank(BENCH_INSTRUCTION, chunks.slice(0, 1), 1);
  } catch (error) {
    console.log(`| ${spec.name} | ${dtype} | – | not available: ${describeError(error)} | – |`);
    process.exit(0);
  }
  const loadMs = elapsedMs(loadStarted);

  for (const size of SIZES) {
    const sample = chunks.slice(0, size);
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      times.push((await reranker.rerank(BENCH_INSTRUCTION, sample, size)).stats.elapsedMs);
    }
    const { median } = latencyOf(times);
    console.log(
      `| ${spec.name} | ${dtype} | ${size} | ${formatSeconds(median, 2)} | ${formatSeconds(median / size, 2)} |`,
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

/** `[--reranker <cross-encoder>] [--dtype int8|fp32]`, by default minilm in int8. */
function parseRerankBenchArgs(args: string[]): { spec: CrossEncoderSpec; dtype: ModelDtype } {
  const { values } = parseArgs({
    args,
    options: {
      reranker: { type: 'string', default: minilmReranker.crossEncoder.name },
      dtype: { type: 'string', default: 'int8' },
    },
  });
  const crossEncoders = localCrossEncoders();
  const spec = crossEncoders.find(({ name }) => name === values.reranker);
  if (!spec) {
    const names = crossEncoders.map(({ name }) => name).join(', ');
    throw new Error(`--reranker must be a local cross-encoder: ${names}`);
  }
  return { spec, dtype: checkDtype(values.dtype) };
}
