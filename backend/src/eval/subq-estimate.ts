// How many SubQ calls an evaluation command makes at most (E9-1), for the guard that asks before a
// paid run. Each count is an upper bound: every candidate is assumed judged (no cache hits), every
// list full and every translation to reach the three largest areas.

import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import type { Tag } from '../llm/types.js';
import { loadQueryTranslatorConfig } from '../query/config.js';
import { loadRerankerConfig } from '../rerank/factory.js';
import { loadSearchConfig } from '../search/config.js';
import { hasSystemOneKey } from '../systemone/config.js';
import { relevanceQuestion } from '../llm/judge-question.js';
import { MAX_AREAS, prepareVocabulary } from '../query/systemone-translator.js';
import { sum } from '../stats.js';
import {
  addCalls,
  callsOf,
  confirmPaidRun,
  estimateCost,
  NO_CALLS,
  timesCalls,
  type ConfirmOptions,
  type PaidCalls,
} from '../systemone/paid-run.js';
import { SWEEP_CANDIDATES } from './sweep.js';

/** A command's SubQ work, before the query texts and chunk sizes are known. */
export interface SubqWork {
  /** SubQ translations per query (0 unless `QUERY_TRANSLATOR_IMPL=subq`). */
  translationsPerQuery: number;
  /** SubQ judgements per query, at most. */
  judgementsPerQuery: number;
  /** SubQ judgements on top of those, over the whole run (the comparison's cache-off pass). */
  extraJudgements: number;
}

/** Whether a command with this work calls SubQ at all. */
export function callsSubq(work: SubqWork): boolean {
  return work.translationsPerQuery + work.judgementsPerQuery + work.extraJudgements > 0;
}

/** `eval:run`: one translation per query; `tags+subq` judges the tag candidates when SubQ has a key. */
export function evalWork(env: Env): SubqWork {
  return {
    translationsPerQuery: subqTranslates(env) ? 1 : 0,
    judgementsPerQuery: hasSystemOneKey(env, 'subq') ? loadSearchConfig(env).maxCandidates : 0,
    extraJudgements: 0,
  };
}

/** The comparison's candidate lists per query: tag search and the full-text baseline. */
const COMPARED_LISTS = 2;

/**
 * `eval:run -- --reranker …`: one translation per query; with `subq` among the rerankers, the tag
 * and full-text lists judged (up to `MAX_CANDIDATES` each), then the first `latencyQueries` lists
 * again with the cache off.
 */
export function compareWork(
  env: Env,
  rerankers: readonly string[],
  latencyQueries: number,
): SubqWork {
  // Without a key the comparison skips the subq reranker, so it calls nothing.
  const perQuery =
    rerankers.includes('subq') && hasSystemOneKey(env, 'subq')
      ? COMPARED_LISTS * loadSearchConfig(env).maxCandidates
      : 0;
  return {
    translationsPerQuery: subqTranslates(env) ? 1 : 0,
    judgementsPerQuery: perQuery,
    extraJudgements: perQuery * latencyQueries,
  };
}

/** `eval:run -- --sweep`: one translation per query; the configured reranker judges every swept list. */
export function sweepWork(env: Env): SubqWork {
  return {
    translationsPerQuery: subqTranslates(env) ? 1 : 0,
    judgementsPerQuery: loadRerankerConfig(env).name === 'subq' ? Math.max(...SWEEP_CANDIDATES) : 0,
    extraJudgements: 0,
  };
}

/**
 * `bench:compare`: per run and query, the main flow translates and judges its candidates with
 * `RERANKER`. The reference RAG always judges with the LLM (`REFERENCE_RERANKER`).
 */
export function benchWork(env: Env, runs: number): SubqWork {
  return {
    translationsPerQuery: subqTranslates(env) ? runs : 0,
    judgementsPerQuery:
      loadRerankerConfig(env).name === 'subq' ? runs * loadSearchConfig(env).maxCandidates : 0,
    extraJudgements: 0,
  };
}

/** What the estimate needs to know about the run's queries and corpus. */
interface SubqRunText {
  /** The instruction of every query run. */
  instructions: readonly string[];
  vocabulary: readonly Tag[];
  /** The longest judged text, from {@link maxJudgedChars}. */
  maxJudgedChars: number;
}

/**
 * Whether a run doing `work` may go on: at once, without a word, when it does not call SubQ; else
 * only once the estimate has been printed and confirmed (or `--yes` given).
 */
export async function confirmSubqRun(
  work: SubqWork,
  text: () => SubqRunText,
  options: ConfirmOptions,
): Promise<boolean> {
  if (!callsSubq(work)) return true;
  return confirmPaidRun(estimateCost(subqCalls(work, text())), options);
}

/** The calls `work` makes over the queries' `instructions`. */
export function subqCalls(
  work: SubqWork,
  { instructions, vocabulary, maxJudgedChars }: SubqRunText,
): PaidCalls {
  return addCalls(
    timesCalls(translationCalls(instructions, vocabulary), work.translationsPerQuery),
    judgeCalls(
      instructions.length * work.judgementsPerQuery + work.extraJudgements,
      maxJudgedChars,
      instructions,
    ),
  );
}

/**
 * The longest text a judge is sent: a chunk's source reference, a blank line and its text, as
 * `judgedText` builds it.
 */
export function maxJudgedChars(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(LENGTH(text) + COALESCE(LENGTH(source_ref), 0) + 2), 0) AS chars
       FROM chunks`,
    )
    .get() as { chars: number };
  return row.chars;
}

function subqTranslates(env: Env): boolean {
  return loadQueryTranslatorConfig(env).impl === 'subq';
}

/**
 * `judgements` judge calls, each sending at most `maxJudgedChars` of chunk and the relevance
 * question about the longest of `instructions`.
 */
function judgeCalls(
  judgements: number,
  maxJudgedChars: number,
  instructions: readonly string[],
): PaidCalls {
  const question = Math.max(0, ...instructions.map((text) => relevanceQuestion(text).length));
  return callsOf(judgements, maxJudgedChars + question);
}

/**
 * Translating each of `instructions` once: the Choice question over the areas, then the tag
 * questions of {@link MAX_AREAS} areas in the translator's own calls of at most 16 questions. The
 * calls and the characters are each counted for the areas with the most of them, so both stay
 * upper bounds whichever areas a translation picks.
 */
export function translationCalls(
  instructions: readonly string[],
  vocabulary: readonly Tag[],
): PaidCalls {
  if (instructions.length === 0) return NO_CALLS;
  const instructionChars = Math.max(...instructions.map((instruction) => instruction.length));
  const { areaQuestion, tagQuestionCallsByArea } = prepareVocabulary(vocabulary);
  const callOf = (questions: object) =>
    callsOf(1, instructionChars + JSON.stringify(questions).length);
  const areas = [...tagQuestionCallsByArea.values()].map((calls) => addCalls(...calls.map(callOf)));
  const most = (key: keyof PaidCalls) =>
    sum(
      areas
        .map((area) => area[key])
        .sort((a, b) => b - a)
        .slice(0, MAX_AREAS),
    );
  const perQuery = addCalls(callOf(areaQuestion), { calls: most('calls'), chars: most('chars') });
  return timesCalls(perQuery, instructions.length);
}
