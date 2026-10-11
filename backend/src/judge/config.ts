import { readOneOf, readPositiveInteger, readShare } from '../env.js';
import { MAX_TIMER_MS } from '../http.js';
import { hasJevKey, loadJevConfig, type JevConfig } from '../jev/config.js';

const JUDGE_IMPLS = ['jev', 'llm', 'jev-with-fallback'] as const;

const DEFAULT_JUDGE_THRESHOLD = 0.5;

// A judgement is one chunk of many, so JEV gets less time than for a query translation.
const DEFAULT_JUDGE_TIMEOUT_MS = 10_000;

export type JudgeConfig = {
  /** A chunk is relevant when its score is at least this, 0–1. */
  threshold: number;
  /** Why the LLM judges although JEV was asked for (no JEV key), for a startup warning. */
  warning?: string;
} & (
  | { impl: 'llm' }
  | {
      impl: 'jev' | 'jev-with-fallback';
      /** The JEV settings, with `JUDGE_TIMEOUT_MS` as the timeout. */
      jev: JevConfig;
    }
);

/**
 * Reads `JUDGE_IMPL` (`jev-with-fallback` by default), `JUDGE_THRESHOLD`, `JUDGE_TIMEOUT_MS` and,
 * for JEV, the JEV settings. `jev-with-fallback` without `JEV_API_KEY` becomes `llm` with a
 * warning, so the app runs before a JEV key exists; `jev` without it is an error.
 */
export function loadJudgeConfig(env: Record<string, string | undefined>): JudgeConfig {
  const threshold = readShare(env, 'JUDGE_THRESHOLD', DEFAULT_JUDGE_THRESHOLD);
  const timeoutMs = loadJudgeTimeoutMs(env);
  const impl = readOneOf(env, 'JUDGE_IMPL', JUDGE_IMPLS, 'jev-with-fallback');
  if (impl === 'llm') return { impl, threshold };
  if (impl === 'jev-with-fallback' && !hasJevKey(env)) {
    return {
      impl: 'llm',
      threshold,
      warning:
        'JEV_API_KEY is not set, so the LLM judges instead of JEV (JUDGE_IMPL is jev-with-fallback)',
    };
  }
  return { impl, threshold, jev: loadJevConfig(env, `JUDGE_IMPL is ${impl}`, timeoutMs) };
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
