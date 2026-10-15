import { readOneOf, readPositiveInteger, readShare } from '../env.js';
import { MAX_TIMER_MS } from '../http.js';
import { loadJevConfig, type JevConfig } from '../jev/config.js';

// Per judge: the LLM's is E7-7's sweep with the Haiku judge (the highest F1 on the central chunks);
// JEV's stays the requirements' 0.5 until #79 measures JEV.
const DEFAULT_JUDGE_THRESHOLDS: Record<JudgeImpl, number> = { llm: 0.8, jev: 0.5 };

// A judgement is one chunk of many, so JEV gets less time than for a query translation.
const DEFAULT_JUDGE_TIMEOUT_MS = 10_000;

/** The judges behind the `jev` and `llm` rerankers. */
export type JudgeImpl = 'jev' | 'llm';

export type JudgeConfig = {
  /** A chunk is relevant when its score is at least this, 0–1. */
  threshold: number;
} & (
  | { impl: 'llm' }
  | {
      /** JEV, and the judge's LLM when a JEV call fails. */
      impl: 'jev';
      /** The JEV settings, with `JUDGE_TIMEOUT_MS` as the timeout. */
      jev: JevConfig;
    }
);

/**
 * The settings of the judge behind the `impl` reranker: `JUDGE_THRESHOLD`, `JUDGE_TIMEOUT_MS` and,
 * for JEV, the JEV settings. `jev` without `JEV_API_KEY` is an error.
 */
export function loadJudgeConfig(
  env: Record<string, string | undefined>,
  impl: JudgeImpl,
): JudgeConfig {
  const threshold = readShare(env, 'JUDGE_THRESHOLD', DEFAULT_JUDGE_THRESHOLDS[impl]);
  const timeoutMs = loadJudgeTimeoutMs(env);
  if (impl === 'llm') return { impl, threshold };
  return { impl, threshold, jev: loadJevConfig(env, `RERANKER is ${impl}`, timeoutMs) };
}

/** `JUDGE_TIMEOUT_MS`: how long JEV gets per judgement. */
export function loadJudgeTimeoutMs(env: Record<string, string | undefined>): number {
  return readPositiveInteger(env, 'JUDGE_TIMEOUT_MS', DEFAULT_JUDGE_TIMEOUT_MS, MAX_TIMER_MS);
}

const DEFAULT_JUDGING = {
  concurrency: 8,
  // Room for JEV's own timeout (JUDGE_TIMEOUT_MS) followed by an LLM fallback.
  chunkTimeoutMs: 30_000,
  totalTimeoutMs: 60_000,
} as const;

export interface JudgingConfig {
  /** At most this many judge calls in flight. */
  concurrency: number;
  /** How long one chunk's judgement may take, fallback included. */
  chunkTimeoutMs: number;
  /** How long judging all of a query's candidates may take. */
  totalTimeoutMs: number;
  /** Whether scores are read from and written to the judge cache by default. */
  cache: boolean;
}

/** Reads `JUDGE_CONCURRENCY`, `JUDGE_CHUNK_TIMEOUT_MS`, `JUDGE_TOTAL_TIMEOUT_MS` and `JUDGE_CACHE`. */
export function loadJudgingConfig(env: Record<string, string | undefined>): JudgingConfig {
  return {
    concurrency: readPositiveInteger(env, 'JUDGE_CONCURRENCY', DEFAULT_JUDGING.concurrency),
    chunkTimeoutMs: readPositiveInteger(
      env,
      'JUDGE_CHUNK_TIMEOUT_MS',
      DEFAULT_JUDGING.chunkTimeoutMs,
      MAX_TIMER_MS,
    ),
    totalTimeoutMs: readPositiveInteger(
      env,
      'JUDGE_TOTAL_TIMEOUT_MS',
      DEFAULT_JUDGING.totalTimeoutMs,
      MAX_TIMER_MS,
    ),
    cache: readOneOf(env, 'JUDGE_CACHE', ['on', 'off'], 'on') === 'on',
  };
}
