// Runs the evaluation set through each search mode (E5-3). The real searches, translator and judges
// are passed in, so the same code runs against the database or against fakes in tests.

import type { Chunk, JudgeScore } from '../llm/types.js';
import type { RerankResult, Reranker } from '../rerank/types.js';
import { describeError } from '../errors.js';
import { sum } from '../stats.js';
import {
  averageOver,
  precisionRecall,
  recommendThreshold,
  sweepThresholds,
  type ChunkScore,
  type ModeScores,
  type Relevance,
  type SweepRow,
} from './metrics.js';
import type { EvalQuery, ResolvedQuery } from './queries.js';

export const EVAL_MODES = ['tags', 'tags+jev', 'tags+llm', 'fts'] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

export const JUDGE_MODES = ['tags+jev', 'tags+llm'] as const;
export type JudgeMode = (typeof JUDGE_MODES)[number];

/** Which reranker a judge mode used, for the report. */
export type RerankerIdentity = Pick<Reranker, 'name' | 'model'>;

/** What a search needs from a query; the relevant chunks are not involved. */
export type QueryText = Pick<EvalQuery, 'instruction' | 'template'>;

/** How the query is turned into candidates, shared by the label tool. */
export interface SearchDependencies {
  /** The query's tags, from the configured query translator and the template's presets. */
  translate(query: QueryText): Promise<string[]>;
  /** Candidate chunk ids from candidate search in mode `tags` or `fts`. */
  search(query: QueryText, tags: readonly string[], mode: 'tags' | 'fts'): string[];
  loadChunks(ids: readonly string[]): Chunk[];
}

export interface EvalDependencies extends SearchDependencies {
  /** Reranks the chunks with the reranker of `mode`, keeping every relevant one (cache on). */
  judge(mode: JudgeMode, instruction: string, chunks: readonly Chunk[]): Promise<RerankResult>;
  /** The judge each judge mode was configured with, for the report. */
  judges: Record<JudgeMode, RerankerIdentity>;
  /** Called after each query, for progress output. */
  onQuery?(outcome: QueryOutcome, index: number, total: number): void;
  onFailure?(failure: FailedQuery, index: number, total: number): void;
}

/** How many judgements each judge gave, judged or cached. */
export type AnsweredBy = Record<JudgeScore['judgedBy'], number>;

export interface QueryOutcome {
  query: ResolvedQuery;
  tags: string[];
  /** The chunk ids each mode returned. */
  returned: Record<EvalMode, string[]>;
  relevance: Record<EvalMode, Relevance>;
  /** Each judge mode's scores, for the sweep; unknown chunks are left out. */
  scores: Record<JudgeMode, ChunkScore[]>;
  answeredBy: Record<JudgeMode, AnsweredBy>;
  unknown: Record<JudgeMode, number>;
}

/** A query that could not be evaluated; it is left out of the averages. */
export interface FailedQuery {
  id: string;
  error: string;
}

export interface EvalResult {
  /** The queries evaluated; the averages are over these. */
  queries: QueryOutcome[];
  failed: FailedQuery[];
  /** Macro averages over the queries. */
  modes: Record<EvalMode, ModeScores>;
  sweeps: Record<JudgeMode, SweepRow[]>;
  recommended: Record<JudgeMode, SweepRow>;
  judges: Record<JudgeMode, RerankerIdentity>;
  /** Judgements per judge over the whole run. */
  answeredBy: Record<JudgeMode, AnsweredBy>;
}

/** Runs every query through every mode, one query at a time. */
export async function runEvaluation(
  queries: readonly ResolvedQuery[],
  deps: EvalDependencies,
): Promise<EvalResult> {
  const outcomes: QueryOutcome[] = [];
  const failed: FailedQuery[] = [];
  for (const [index, query] of queries.entries()) {
    // One failing query (e.g. the LLM refusing to answer) must not lose the others' results.
    try {
      const outcome = await evaluateQuery(query, deps);
      outcomes.push(outcome);
      deps.onQuery?.(outcome, index, queries.length);
    } catch (error) {
      failed.push({ id: query.id, error: describeError(error) });
      deps.onFailure?.(failed.at(-1)!, index, queries.length);
    }
  }

  const sweeps = byJudgeMode((mode) =>
    sweepThresholds(
      outcomes.map(({ query, scores }) => ({ scores: scores[mode], relevant: query.relevantIds })),
    ),
  );
  return {
    queries: outcomes,
    failed,
    modes: byEvalMode((mode) => averageOver(outcomes.map((o) => o.relevance[mode]))),
    sweeps,
    recommended: byJudgeMode((mode) => recommendThreshold(sweeps[mode])),
    judges: deps.judges,
    answeredBy: byJudgeMode((mode) => ({
      jev: sum(outcomes.map((o) => o.answeredBy[mode].jev)),
      llm: sum(outcomes.map((o) => o.answeredBy[mode].llm)),
    })),
  };
}

async function evaluateQuery(query: ResolvedQuery, deps: EvalDependencies): Promise<QueryOutcome> {
  const tags = await deps.translate(query);
  const tagCandidates = deps.search(query, tags, 'tags');
  const chunks = deps.loadChunks(tagCandidates);
  // Without a JEV key both modes have the same judge; it is asked once, so the rows agree exactly.
  const jevJudged = await deps.judge('tags+jev', query.instruction, chunks);
  const judged: Record<JudgeMode, RerankResult> = {
    'tags+jev': jevJudged,
    'tags+llm': sameJudge(deps.judges)
      ? jevJudged
      : await deps.judge('tags+llm', query.instruction, chunks),
  };
  const returned: Record<EvalMode, string[]> = {
    tags: tagCandidates,
    ...byJudgeMode((mode) => judged[mode].ranked.map(({ chunk }) => chunk.id)),
    fts: deps.search(query, tags, 'fts'),
  };
  return {
    query,
    tags,
    returned,
    relevance: byEvalMode((mode) => precisionRecall(returned[mode], query.relevantIds)),
    scores: byJudgeMode((mode) =>
      judged[mode].scored.map(({ chunk, score }) => ({ chunkId: chunk.id, score })),
    ),
    answeredBy: byJudgeMode((mode) => countByJudge(judged[mode].scored)),
    unknown: byJudgeMode((mode) => judged[mode].stats.unknown),
  };
}

function sameJudge(judges: Record<JudgeMode, RerankerIdentity>): boolean {
  const [jev, llm] = [judges['tags+jev'], judges['tags+llm']];
  return jev.name === llm.name && jev.model === llm.model;
}

function countByJudge(scored: readonly { answeredBy?: JudgeScore['judgedBy'] }[]): AnsweredBy {
  const counts: AnsweredBy = { jev: 0, llm: 0 };
  for (const { answeredBy } of scored) if (answeredBy) counts[answeredBy] += 1;
  return counts;
}

export function byJudgeMode<T>(value: (mode: JudgeMode) => T): Record<JudgeMode, T> {
  return { 'tags+jev': value('tags+jev'), 'tags+llm': value('tags+llm') };
}

function byEvalMode<T>(value: (mode: EvalMode) => T): Record<EvalMode, T> {
  return { tags: value('tags'), ...byJudgeMode(value), fts: value('fts') };
}
