// The local cross-encoder rerankers (E8-3, E7-5): a cross-encoder such as bge-reranker-v2-m3 scores
// each (instruction, chunk) pair locally, and its logit becomes a score from 0 to 1 by a sigmoid.
// Nothing is cached: the model is local and free, and its uncached time is what should be measured.
// Each model is one `RERANKERS` entry made with `crossEncoderReranker`.

import { readShare, type Env } from '../env.js';
import { elapsedMs } from '../http.js';
import { isRelevant } from '../judge/factory.js';
import { NO_USAGE, type LlmLogger } from '../llm/client.js';
import { describeError } from '../errors.js';
import { spellOutLawAbbreviations } from '../legal/law-names.js';
import type { Chunk } from '../llm/types.js';
import { loadLocalModelConfig, type LocalModelConfig } from '../models/config.js';
import { passageText } from '../models/passages.js';
import { inBatches, lazyRetry, loadCrossEncoder, oneAtATime } from '../models/runtime.js';
import { bestFirst } from './rank.js';
import type { CrossEncoderSpec, RerankResult, Reranker, RerankerEntry } from './types.js';

export interface CrossEncoderRerankerConfig extends LocalModelConfig {
  /** `RERANK_THRESHOLD_<NAME>`: a chunk is relevant when its score is at least this, 0–1. */
  threshold: number;
}

/** `RERANKER_DTYPE`, `RERANKER_BATCH_SIZE`, `MODEL_CACHE_DIR` and `RERANK_THRESHOLD_<NAME>`. */
export function loadCrossEncoderRerankerConfig(env: Env, name: string): CrossEncoderRerankerConfig {
  return {
    ...loadLocalModelConfig(env, 'RERANKER'),
    // A cross-encoder's scores are not calibrated like JEV's or the LLM's, so by default only topK
    // cuts.
    threshold: readShare(env, thresholdVariable(name), 0),
  };
}

/** The setting that holds a cross-encoder's threshold, e.g. `RERANK_THRESHOLD_MINILM`. */
export function thresholdVariable(name: string): string {
  return `RERANK_THRESHOLD_${name.toUpperCase()}`;
}

/** A `RERANKERS` entry for a local cross-encoder; the registry files it under `spec.name`. */
export function crossEncoderReranker(
  spec: CrossEncoderSpec,
): RerankerEntry & { crossEncoder: CrossEncoderSpec } {
  return {
    remote: false,
    crossEncoder: spec,
    validate(env) {
      loadCrossEncoderRerankerConfig(env, spec.name);
    },
    create(env, { logger }) {
      return createCrossEncoderReranker(
        spec,
        loadCrossEncoderRerankerConfig(env, spec.name),
        logger,
      );
    },
  };
}

/**
 * Scores every chunk's heading path and text against the instruction, best first. The instruction
 * gets its law abbreviations spelled out, as for the embedder, since the heading paths name the
 * laws in words. The model loads on the first rerank with chunks (a failed load fails the rerank);
 * pairs of similar length are scored `config.batchSize` at a time, and a batch that fails leaves
 * its chunks unknown. One rerank runs at a time, since each uses every CPU core.
 */
export function createCrossEncoderReranker(
  { name, model }: CrossEncoderSpec,
  config: CrossEncoderRerankerConfig,
  logger: LlmLogger,
  loadModel: typeof loadCrossEncoder = loadCrossEncoder,
): Reranker {
  const scorer = lazyRetry(async () => {
    const started = performance.now();
    const score = await loadModel(model, config.dtype, config.cacheDir);
    logger.info(
      { role: 'reranker', model: model.id, dtype: config.dtype, loadMs: elapsedMs(started) },
      'Reranker model loaded',
    );
    return score;
  });

  /** The chunks' scores, in input order, undefined where a batch failed; a cut pair is logged. */
  const scoreAll = oneAtATime(async (instruction: string, chunks: readonly Chunk[]) => {
    const score = await scorer();
    const query = spellOutLawAbbreviations(instruction);
    const passages = chunks.map(passageText);
    // A batch is padded to its longest pair, so pairs of similar length go together.
    const byLength = passages
      .map((_, i) => i)
      .sort((a, b) => passages[a].length - passages[b].length);
    const scores = new Array<number | undefined>(chunks.length);
    for (const batch of inBatches(byLength, config.batchSize)) {
      const pairs = batch.map((i) => ({ query, passage: passages[i] }));
      let results;
      try {
        results = await score(pairs);
      } catch (error) {
        logger.warn(
          {
            role: 'reranker',
            chunkIds: batch.map((i) => chunks[i].id),
            error: describeError(error),
          },
          'Reranker batch failed; its chunks are unknown',
        );
        continue;
      }
      results.forEach(({ logit, truncated }, j) => {
        const chunk = chunks[batch[j]];
        if (truncated) {
          logger.warn(
            { role: 'reranker', chunkId: chunk.id, maxTokens: model.maxTokens },
            'Pair cut to fit the reranker',
          );
        }
        scores[batch[j]] = sigmoid(logit);
      });
    }
    return scores;
  });

  return {
    name,
    model: model.id,
    dtype: config.dtype,
    async rerank(query, chunks, topK): Promise<RerankResult> {
      const started = performance.now();
      const scores = chunks.length > 0 ? await scoreAll(query, chunks) : [];
      const scored = bestFirst(
        chunks.flatMap((chunk, i) => {
          const score = scores[i];
          return score === undefined ? [] : [{ chunk, score, reranker: name, model: model.id }];
        }),
      );
      const relevant = scored.filter(({ score }) => isRelevant(score, config.threshold));
      return {
        judged: config.threshold > 0,
        ranked: relevant.slice(0, topK),
        scored,
        stats: {
          calls: chunks.length,
          cacheHits: 0,
          unknown: chunks.length - scored.length,
          relevant: relevant.length,
          usage: NO_USAGE,
          elapsedMs: elapsedMs(started),
        },
      };
    },
  };
}

/** A logit as a probability from 0 to 1. */
export function sigmoid(logit: number): number {
  return 1 / (1 + Math.exp(-logit));
}
