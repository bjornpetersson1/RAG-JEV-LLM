// Runs the evaluation set through each search mode (E5-3). The real searches, translator and judges
// are passed in, so the same code runs against the database or against fakes in tests.

import type { Chunk, JudgeScore } from '../llm/types.js';
import type { RerankResult, Reranker } from '../rerank/types.js';
import { describeError } from '../errors.js';
import { SYSTEM_ONE_PROVIDERS } from '../systemone/config.js';
import { sum } from '../stats.js';
import {
  averageRanked,
  precisionAt,
  precisionRecall,
  rankedRelevance,
  recommendThreshold,
  sweepThresholds,
  type ChunkScore,
  type RankedRelevance,
  type RankedScores,
  type SweepRow,
} from './metrics.js';
import {
  byGradeScope,
  relevantFor,
  type EvalQuery,
  type GradeScope,
  type ResolvedQuery,
} from './queries.js';

export const EVAL_MODES = ['tags', 'tags+jev', 'tags+subq', 'tags+llm', 'fts'] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

export const JUDGE_MODES = ['tags+jev', 'tags+subq', 'tags+llm'] as const;
export type JudgeMode = (typeof JUDGE_MODES)[number];

/** The kinds of document a chunk can come from (`documents.type`), reported apart (E9-1). */
export const DOCUMENT_TYPES = ['law', 'ruling'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The number of equal score bands from 0 to 1 in a judge's score distribution. */
export const SCORE_BANDS = 10;

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
  /** The document type of each chunk id; unknown ids are absent. */
  documentTypes(ids: readonly string[]): ReadonlyMap<string, DocumentType>;
  /** Reranks the chunks with the reranker of `mode`, keeping every relevant one (cache on). */
  judge(mode: JudgeMode, instruction: string, chunks: readonly Chunk[]): Promise<RerankResult>;
  /** The judge each judge mode was configured with, for the report. */
  judges: Record<JudgeMode, RerankerIdentity>;
  /** `RERANK_TOP_K`: the threshold sweep keeps at most this many per query, as the query flow does. */
  topK: number;
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
  /** Each mode's list measured against the central chunks and against every graded chunk. */
  relevance: Record<EvalMode, Record<GradeScope, RankedRelevance>>;
  /**
   * The same, counting only the returned and relevant chunks of one document type; undefined when
   * the query has no relevant chunk of that type in that scope.
   */
  relevanceByType: Record<
    EvalMode,
    Record<DocumentType, Record<GradeScope, RankedRelevance | undefined>>
  >;
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
  /** Macro averages over the queries, per grade scope. */
  modes: Record<EvalMode, Record<GradeScope, RankedScores>>;
  /** The macro averages per document type, over the queries with a relevant chunk of that type. */
  modesByType: Record<EvalMode, Record<DocumentType, Record<GradeScope, TypeScores>>>;
  /** Per judge mode, the queries whose judge approved none of the candidates. */
  noneApproved: Record<JudgeMode, number>;
  /** Per judge mode, the share of its scores in each of {@link SCORE_BANDS} bands from 0 to 1. */
  scoreDistribution: Record<JudgeMode, number[]>;
  /** Each judge mode's threshold sweep against the central chunks and against every graded chunk. */
  sweeps: Record<JudgeMode, Record<GradeScope, SweepRow[]>>;
  /** The central sweep's best row (E7-7: the central chunks are what a clause rests on). */
  recommended: Record<JudgeMode, SweepRow>;
  /** The sweep's cap per query, `RERANK_TOP_K`. */
  topK: number;
  judges: Record<JudgeMode, RerankerIdentity>;
  /** Judgements per judge over the whole run. */
  answeredBy: Record<JudgeMode, AnsweredBy>;
}

/** A document type's averages and the number of queries they are over. */
export type TypeScores = RankedScores & { queries: number };

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
    byGradeScope((scope) =>
      sweepThresholds(
        outcomes.map(({ query, scores }) => ({
          scores: scores[mode],
          relevant: relevantFor(query, scope),
        })),
        deps.topK,
      ),
    ),
  );
  return {
    queries: outcomes,
    failed,
    modes: byEvalMode((mode) =>
      byGradeScope((scope) => averageRanked(outcomes.map((o) => o.relevance[mode][scope]))),
    ),
    modesByType: byEvalMode((mode) =>
      byDocumentType((type) =>
        byGradeScope((scope) => {
          const rows = outcomes.flatMap((o) => o.relevanceByType[mode][type][scope] ?? []);
          return { ...averageRanked(rows), queries: rows.length };
        }),
      ),
    ),
    // Only a query with judged candidates counts: none at all, or only unknown ones, is no verdict.
    noneApproved: byJudgeMode(
      (mode) =>
        outcomes.filter(
          (outcome) => outcome.scores[mode].length > 0 && outcome.returned[mode].length === 0,
        ).length,
    ),
    scoreDistribution: byJudgeMode((mode) =>
      scoreDistribution(outcomes.flatMap((outcome) => outcome.scores[mode])),
    ),
    sweeps,
    recommended: byJudgeMode((mode) => recommendThreshold(sweeps[mode].central)),
    topK: deps.topK,
    judges: deps.judges,
    answeredBy: byJudgeMode((mode) => {
      const total = noAnswers();
      for (const judge of JUDGES)
        total[judge] = sum(outcomes.map((o) => o.answeredBy[mode][judge]));
      return total;
    }),
  };
}

async function evaluateQuery(query: ResolvedQuery, deps: EvalDependencies): Promise<QueryOutcome> {
  const tags = await deps.translate(query);
  const tagCandidates = deps.search(query, tags, 'tags');
  const chunks = deps.loadChunks(tagCandidates);
  // Without a JEV or SubQ key a mode has the LLM as its judge; each judge is asked once, so the rows
  // of modes with the same judge agree exactly.
  const byJudge = new Map<string, RerankResult>();
  const judged = {} as Record<JudgeMode, RerankResult>;
  for (const mode of JUDGE_MODES) {
    const key = judgeKey(deps.judges[mode]);
    if (!byJudge.has(key)) byJudge.set(key, await deps.judge(mode, query.instruction, chunks));
    judged[mode] = byJudge.get(key)!;
  }
  const returned: Record<EvalMode, string[]> = {
    tags: tagCandidates,
    ...byJudgeMode((mode) => judged[mode].ranked.map(({ chunk }) => chunk.id)),
    fts: deps.search(query, tags, 'fts'),
  };
  const types = deps.documentTypes([
    ...new Set([...Object.values(returned).flat(), ...query.relevantIds]),
  ]);
  const ofType = (ids: Iterable<string>, type: DocumentType) =>
    [...ids].filter((id) => types.get(id) === type);
  return {
    query,
    tags,
    returned,
    relevance: byEvalMode((mode) =>
      byGradeScope((scope) => rankedRelevance(returned[mode], relevantFor(query, scope))),
    ),
    relevanceByType: byEvalMode((mode) =>
      byDocumentType((type) =>
        byGradeScope((scope) => {
          const relevant = new Set(ofType(relevantFor(query, scope), type));
          if (relevant.size === 0) return undefined;
          // Precision and recall over the type's own chunks; P@K over the list's real top K.
          return {
            ...precisionRecall(ofType(returned[mode], type), relevant),
            precision5: precisionAt(returned[mode], relevant, 5),
            precision10: precisionAt(returned[mode], relevant, 10),
          };
        }),
      ),
    ),
    scores: byJudgeMode((mode) =>
      judged[mode].scored.map(({ chunk, score }) => ({ chunkId: chunk.id, score })),
    ),
    answeredBy: byJudgeMode((mode) => countByJudge(judged[mode].scored)),
    unknown: byJudgeMode((mode) => judged[mode].stats.unknown),
  };
}

function judgeKey({ name, model }: RerankerIdentity): string {
  return JSON.stringify([name, model]);
}

/** The share of `scores` in each of {@link SCORE_BANDS} bands; a score of 1 is in the top band. */
function scoreDistribution(scores: readonly ChunkScore[]): number[] {
  const counts = new Array<number>(SCORE_BANDS).fill(0);
  for (const { score } of scores)
    counts[Math.min(SCORE_BANDS - 1, Math.floor(score * SCORE_BANDS))] += 1;
  return counts.map((count) => (scores.length === 0 ? 0 : count / scores.length));
}

/** Every judge that can answer: the System One models and the LLM. */
const JUDGES = [...SYSTEM_ONE_PROVIDERS, 'llm'] as const;

function noAnswers(): AnsweredBy {
  return Object.fromEntries(JUDGES.map((judge) => [judge, 0])) as AnsweredBy;
}

function countByJudge(scored: readonly { answeredBy?: JudgeScore['judgedBy'] }[]): AnsweredBy {
  const counts = noAnswers();
  for (const { answeredBy } of scored) if (answeredBy) counts[answeredBy] += 1;
  return counts;
}

export function byJudgeMode<T>(value: (mode: JudgeMode) => T): Record<JudgeMode, T> {
  return {
    'tags+jev': value('tags+jev'),
    'tags+subq': value('tags+subq'),
    'tags+llm': value('tags+llm'),
  };
}

function byDocumentType<T>(value: (type: DocumentType) => T): Record<DocumentType, T> {
  return { law: value('law'), ruling: value('ruling') };
}

function byEvalMode<T>(value: (mode: EvalMode) => T): Record<EvalMode, T> {
  return { tags: value('tags'), ...byJudgeMode(value), fts: value('fts') };
}
