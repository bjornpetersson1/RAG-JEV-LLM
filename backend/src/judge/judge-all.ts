import type { DatabaseSync } from 'node:sqlite';
import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { sumUsage, type LlmLogger, type LlmUsage } from '../llm/client.js';
import type { Chunk, JudgeScore } from '../llm/types.js';
import { relevanceQuestion } from '../llm/judge-question.js';
import { createJudgeCache, type JudgeCache } from './cache.js';
import type { JudgingConfig } from './config.js';
import { isRelevant, type Judging } from './factory.js';

/** `cached` came from the judge cache; `unknown` could not be judged and counts as not relevant. */
export type ChunkJudgement =
  | {
      chunkId: string;
      status: 'judged' | 'cached';
      score: number;
      relevant: boolean;
      judgedBy: JudgeScore['judgedBy'];
      elapsedMs: number;
    }
  | {
      chunkId: string;
      status: 'unknown';
      /** Why the chunk could not be judged. */
      reason: string;
      elapsedMs: number;
    };

export interface JudgeAllResult {
  /** One per chunk, in input order. */
  judgements: ChunkJudgement[];
  /** The relevant chunks, in input order. */
  relevant: Chunk[];
  elapsedMs: number;
  cacheHits: number;
  judgeCalls: number;
  unknown: number;
  /** Tokens used by this call's judge calls; cache hits cost none. */
  usage: LlmUsage;
}

export interface JudgeAllDependencies {
  /** The judge, its cache identity and the threshold, from `createJudging`. */
  judging: Judging;
  config: JudgingConfig;
  db: DatabaseSync;
  logger: LlmLogger;
}

export interface JudgeAllOptions {
  /** Overrides `JUDGE_CACHE`, e.g. `false` for timing measurements. */
  cache?: boolean;
}

const OVERALL_TIMEOUT = 'overall timeout';

/**
 * Judges `chunks` against `instruction`, `config.concurrency` at a time, deciding relevance with
 * the judging's threshold. Cached scores are used
 * without a call; new scores from the primary judge are cached (not those of an LLM fallback). A
 * chunk whose judgement fails or exceeds `chunkTimeoutMs` is `unknown`; when `totalTimeoutMs` is
 * reached, calls in flight are cancelled and every chunk not yet judged is `unknown`.
 */
export async function judgeAll(
  instruction: string,
  chunks: readonly Chunk[],
  deps: JudgeAllDependencies,
  options: JudgeAllOptions = {},
): Promise<JudgeAllResult> {
  const { judging, config, db, logger } = deps;
  const { judge, primary, threshold } = judging;
  const started = performance.now();
  // Bad input fails the same way whether or not the cache is on.
  rejectEmptyInstruction(instruction);
  rejectDuplicateIds(chunks);
  const cache =
    (options.cache ?? config.cache) ? createJudgeCache(db, instruction, primary) : undefined;

  const results = new Map<string, ChunkJudgement>();
  for (const [chunkId, score] of readCache(cache, chunks, logger)) {
    results.set(chunkId, scored(chunkId, 'cached', score, primary.impl, 0));
  }
  const cacheHits = results.size;
  const queue = chunks.filter((chunk) => !results.has(chunk.id));
  const usages: LlmUsage[] = [];
  const toCache: { chunk: Chunk; score: number }[] = [];
  let judgeCalls = 0;

  const overall = new AbortController();
  const overallTimer = setTimeout(() => overall.abort(), config.totalTimeoutMs);

  /**
   * Judges one chunk and records its result, then holds the pool slot until the call has really
   * ended: an LLM call cannot be cancelled, so a timed-out chunk may still have one running, and
   * starting the next chunk then would exceed the concurrency limit. The overall timeout releases
   * every slot.
   */
  async function judgeOne(chunk: Chunk): Promise<void> {
    judgeCalls += 1;
    const chunkStarted = performance.now();
    const chunkTimeout = new AbortController();
    const chunkTimer = setTimeout(() => chunkTimeout.abort(), config.chunkTimeoutMs);
    const signal = AbortSignal.any([chunkTimeout.signal, overall.signal]);
    const call = judge.judge(instruction, chunk, signal);
    try {
      const { score, judgedBy, usage } = await untilAborted(call, signal);
      usages.push(usage);
      // An LLM answer standing in for JEV is not cached, so the next run asks JEV again.
      if (judgedBy === primary.impl) toCache.push({ chunk, score });
      results.set(chunk.id, scored(chunk.id, 'judged', score, judgedBy, elapsedMs(chunkStarted)));
    } catch (error) {
      const reason = overall.signal.aborted
        ? OVERALL_TIMEOUT
        : chunkTimeout.signal.aborted
          ? `no judgement within ${config.chunkTimeoutMs} ms`
          : describeError(error);
      // Chunks cut off by the overall timeout get one warning together, below.
      if (reason !== OVERALL_TIMEOUT) {
        logger.warn({ role: 'judge', chunkId: chunk.id, reason }, 'Chunk could not be judged');
      }
      results.set(chunk.id, unknown(chunk.id, reason, elapsedMs(chunkStarted)));
    } finally {
      clearTimeout(chunkTimer);
    }
    await untilAborted(call, overall.signal).catch(() => {});
  }

  let next = 0;
  const worker = async () => {
    while (next < queue.length && !overall.signal.aborted) {
      await judgeOne(queue[next++]);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length) }, worker));
  } finally {
    clearTimeout(overallTimer);
  }
  writeCache(cache, toCache, logger);

  const judgements = chunks.map(
    (chunk) => results.get(chunk.id) ?? unknown(chunk.id, OVERALL_TIMEOUT, 0),
  );
  const cutOff = judgements.filter(
    (judgement) => judgement.status === 'unknown' && judgement.reason === OVERALL_TIMEOUT,
  ).length;
  if (cutOff > 0) {
    logger.warn(
      { role: 'judge', chunks: cutOff, totalTimeoutMs: config.totalTimeoutMs },
      'Judging reached its overall timeout; the chunks not judged are unknown',
    );
  }

  const relevant = chunks.filter((_chunk, i) => {
    const judgement = judgements[i];
    return judgement.status !== 'unknown' && judgement.relevant;
  });
  const unknownCount = judgements.filter((judgement) => judgement.status === 'unknown').length;
  const result: JudgeAllResult = {
    judgements,
    relevant,
    elapsedMs: elapsedMs(started),
    cacheHits,
    judgeCalls,
    unknown: unknownCount,
    usage: sumUsage(usages),
  };
  logger.info(
    {
      role: 'judge',
      chunks: chunks.length,
      relevant: relevant.length,
      cacheHits,
      judgeCalls,
      unknown: unknownCount,
      elapsedMs: result.elapsedMs,
    },
    'Judged chunks',
  );
  return result;

  function scored(
    chunkId: string,
    status: 'judged' | 'cached',
    score: number,
    judgedBy: JudgeScore['judgedBy'],
    elapsed: number,
  ): ChunkJudgement {
    return {
      chunkId,
      status,
      score,
      relevant: isRelevant(score, threshold),
      judgedBy,
      elapsedMs: elapsed,
    };
  }
}

/** Throws for an instruction with no words, the way the judges' question would. */
function rejectEmptyInstruction(instruction: string): void {
  relevanceQuestion(instruction);
}

function rejectDuplicateIds(chunks: readonly Chunk[]): void {
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.has(chunk.id))
      throw new Error(`Chunk "${chunk.id}" is given twice; ids must be unique`);
    seen.add(chunk.id);
  }
}

/** The cached scores, or none when the cache is off or cannot be read: it only saves calls. */
function readCache(
  cache: JudgeCache | undefined,
  chunks: readonly Chunk[],
  logger: LlmLogger,
): Map<string, number> {
  try {
    return cache?.read(chunks) ?? new Map();
  } catch (error) {
    logger.warn({ role: 'judge', error: describeError(error) }, 'Judge cache could not be read');
    return new Map();
  }
}

/** Stores the new scores; a failure is logged, since the judgements themselves are still valid. */
function writeCache(
  cache: JudgeCache | undefined,
  scored: readonly { chunk: Chunk; score: number }[],
  logger: LlmLogger,
): void {
  try {
    cache?.write(scored);
  } catch (error) {
    logger.warn({ role: 'judge', error: describeError(error) }, 'Judge cache could not be written');
  }
}

function unknown(chunkId: string, reason: string, elapsed: number): ChunkJudgement {
  return { chunkId, status: 'unknown', elapsedMs: elapsed, reason };
}

/**
 * `promise`, or a rejection as soon as `signal` aborts. An LLM call cannot be cancelled, so its
 * late result or failure is dropped.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  });
}
