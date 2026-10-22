// Compares retrievers and rerankers on the evaluation set (E8-5): recall@K and precision@5/@10
// before and after rerank, for the central chunks and for every graded chunk (E7-4), and the
// latency of each. The retrievers and rerankers are passed in, so
// the same code runs against the database and models or against fakes in tests.

import { describeError } from '../errors.js';
import type { Chunk } from '../llm/types.js';
import type { Reranker } from '../rerank/types.js';
import { elapsedMs } from '../http.js';
import { latencyOf, mean, type Latency } from '../stats.js';
import { precisionAt, recallAt } from './metrics.js';
import { byGradeScope, relevantFor, type GradeScope, type ResolvedQuery } from './queries.js';

/** A candidate source as the comparison sees it. */
export interface ComparedRetriever {
  name: string;
  /** Whether the retriever uses the query's tags (they are translated once per query). */
  usesTags: boolean;
  /** A baseline is only listed, never reranked (E5-3's full-text search). */
  baseline?: boolean;
  /** Candidate chunk ids, best first, and the time it took. */
  retrieve(
    query: ResolvedQuery,
    tags: readonly string[],
  ): Promise<{ ids: string[]; elapsedMs: number }>;
}

/** A reranker to compare, or why it cannot run. */
export type ComparedReranker =
  | {
      name: string;
      /** With its cache on, as the query flow runs. */
      cached: Reranker;
      /** With its cache off, built only if latency needs it. */
      uncached(): Reranker;
    }
  | { name: string; skipped: string };

export interface CompareDependencies {
  retrievers: readonly ComparedRetriever[];
  rerankers: readonly ComparedReranker[];
  translate(query: ResolvedQuery): Promise<string[]>;
  /** The configured query translator, e.g. `subq subq-snap-preview`, for the rows. */
  translator: string;
  loadChunks(ids: readonly string[]): Chunk[];
  /** Queries a latency is taken over when the cache answered (5). */
  latencyQueries: number;
  onQuery?(query: ResolvedQuery, index: number, total: number): void;
  /** A step that failed for one query, e.g. a translation; the run goes on without it. */
  onFailure?(step: string, query: ResolvedQuery, error: string): void;
}

/** Recall at 5, 8, 10 and the whole list. */
export type RecallAt = Record<'5' | '8' | '10' | 'candidates', number>;

/** A list's recall at each K and precision at 5 and 10. */
export type ListMeasures = RecallAt & { precision5: number; precision10: number };

/** The measures against each grade scope. */
export type GradedMeasures = Record<GradeScope, ListMeasures>;

export interface ComparisonRow {
  retriever: string;
  /** `none` for the retriever's own order. */
  reranker: string;
  model: string;
  /** Mean candidates per query. */
  candidates: number;
  /** The retriever's own order. */
  before: GradedMeasures;
  /** The reranker's score order. */
  after?: GradedMeasures;
  retrievalMs: Latency;
  /** The query translator a tag retriever's rows used; `–` for one that uses no tags. */
  translator: string;
  /** The translation's latency over the row's queries; absent for a retriever without tags (E9-1). */
  translationMs?: Latency;
  /** Absent when no latency could be measured. */
  rerankMs?: Latency;
  /** Queries the row averages over. */
  queries: number;
  notes: string[];
  /** Whether queries failed in this row, or it is skipped for a reason other than its setup. */
  failed: boolean;
}

/** The query translator a row names and its latency; none for a retriever without tags. */
type Translation = Pick<ComparisonRow, 'translator' | 'translationMs'>;

const NO_TRANSLATION: Translation = { translator: '–' };

/** One query's list from a retriever or a reranker, and the time it took. */
interface QueryList {
  query: ResolvedQuery;
  ids: string[];
  elapsedMs: number;
}

/** One reranked list, with what the latency pass needs. */
interface RerankedList extends QueryList {
  chunks: Chunk[];
  cacheHits: number;
}

/** A retriever and reranker pair that failed for this many queries in a row is not asked again. */
const MAX_FAILURES_IN_A_ROW = 3;

/**
 * Runs every query through every retriever, then every retrieved list through every reranker,
 * keeping every relevant chunk (topK = the candidate count). A query whose translation or retrieval
 * fails is left out of that retriever's rows; a reranker that fails on every query, or on three in
 * a row for a retriever, becomes a skipped row with its first error.
 */
export async function compareRerankers(
  queries: readonly ResolvedQuery[],
  deps: CompareDependencies,
): Promise<ComparisonRow[]> {
  const usesTags = deps.retrievers.some((retriever) => retriever.usesTags);
  const retrieved = new Map<string, QueryList[]>();
  const reranked = new Map<string, RerankedList[]>();
  const failures = new Map<string, { first: string; inARow: number }>();
  const failedQueries = new Map<string, number>();
  const translationMs = new Map<string, number>();

  /** `work`'s result, or undefined when it throws, reported: one failure must not lose a run. */
  async function attempt<T>(
    step: string,
    query: ResolvedQuery,
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      deps.onFailure?.(step, query, describeError(error));
      return undefined;
    }
  }

  async function rerankOnce(
    reranker: Extract<ComparedReranker, { cached: Reranker }>,
    key: string,
    query: ResolvedQuery,
    chunks: Chunk[],
  ): Promise<void> {
    const failed = failures.get(key);
    if (failed && failed.inARow >= MAX_FAILURES_IN_A_ROW) return;
    try {
      const { ranked, stats } = await reranker.cached.rerank(
        query.instruction,
        chunks,
        chunks.length,
      );
      if (failed) failed.inARow = 0;
      push(reranked, key, {
        query,
        ids: ranked.map(({ chunk }) => chunk.id),
        elapsedMs: stats.elapsedMs,
        chunks,
        cacheHits: stats.cacheHits,
      });
    } catch (error) {
      const message = describeError(error);
      deps.onFailure?.(`rerank ${reranker.name}`, query, message);
      failures.set(key, { first: failed?.first ?? message, inARow: (failed?.inARow ?? 0) + 1 });
    }
  }

  for (const [index, query] of queries.entries()) {
    const started = performance.now();
    const tags = usesTags ? await attempt('translation', query, () => deps.translate(query)) : [];
    if (usesTags && tags) translationMs.set(query.id, elapsedMs(started));
    for (const retriever of deps.retrievers) {
      const result =
        tags === undefined && retriever.usesTags
          ? undefined
          : await attempt(`retrieval ${retriever.name}`, query, () =>
              retriever.retrieve(query, tags ?? []),
            );
      if (!result) {
        failedQueries.set(retriever.name, (failedQueries.get(retriever.name) ?? 0) + 1);
        continue;
      }
      push(retrieved, retriever.name, { ...result, query });
      if (retriever.baseline) continue;
      const chunks = deps.loadChunks(result.ids);
      for (const reranker of deps.rerankers) {
        if ('skipped' in reranker) continue;
        await rerankOnce(reranker, rowKey(retriever.name, reranker.name), query, chunks);
      }
    }
    deps.onQuery?.(query, index, queries.length);
  }

  const rows: ComparisonRow[] = [];
  for (const retriever of deps.retrievers) {
    const lists = retrieved.get(retriever.name) ?? [];
    const translation: Translation = retriever.usesTags
      ? {
          translator: deps.translator,
          translationMs: latencyOf(lists.map(({ query }) => translationMs.get(query.id) ?? 0)),
        }
      : NO_TRANSLATION;
    const before = beforeRow(
      retriever.name,
      lists,
      failedQueries.get(retriever.name) ?? 0,
      translation,
    );
    rows.push(before);
    if (retriever.baseline) continue;
    for (const reranker of deps.rerankers) {
      const key = rowKey(retriever.name, reranker.name);
      const results = reranked.get(key) ?? [];
      if ('skipped' in reranker) {
        rows.push(skippedRow(before, reranker.name, reranker.skipped, false));
      } else if (results.length === 0) {
        // A reranker that never worked for any retriever (e.g. not implemented) is skipped, like one
        // that could not be built; one that failed here but worked elsewhere is a failure.
        const worked = deps.retrievers.some(
          ({ name }) => (reranked.get(rowKey(name, reranker.name)) ?? []).length > 0,
        );
        const reason = failures.get(key)?.first ?? 'no result';
        rows.push(skippedRow(before, reranker.name, reason, worked));
      } else {
        const latency = await rerankLatency(reranker, results, deps, attempt);
        rows.push(afterRow(before, lists, reranker.cached, results, latency));
      }
    }
  }
  return rows;
}

/**
 * The rerank latency per query. Cache hits make a reranker look fast, so it is taken from the
 * queries without any; when fewer than `latencyQueries` had none, the first `latencyQueries` lists
 * are reranked again with the cache off.
 */
async function rerankLatency(
  reranker: Extract<ComparedReranker, { cached: Reranker }>,
  results: readonly RerankedList[],
  deps: CompareDependencies,
  attempt: <T>(
    step: string,
    query: ResolvedQuery,
    work: () => Promise<T>,
  ) => Promise<T | undefined>,
): Promise<{ latency?: Latency; note?: string }> {
  const uncachedResults = results.filter(({ cacheHits }) => cacheHits === 0);
  if (uncachedResults.length === results.length) {
    return { latency: latencyOf(results.map(({ elapsedMs }) => elapsedMs)) };
  }
  if (uncachedResults.length >= deps.latencyQueries) {
    return {
      latency: latencyOf(uncachedResults.map(({ elapsedMs }) => elapsedMs)),
      note: `rerank latency from the ${uncachedResults.length} queries without cache hits`,
    };
  }
  const uncached = reranker.uncached();
  const times: number[] = [];
  for (const { query, chunks } of results.slice(0, deps.latencyQueries)) {
    const timed = await attempt(`latency ${reranker.name}`, query, () =>
      uncached.rerank(query.instruction, chunks, chunks.length),
    );
    if (timed) times.push(timed.stats.elapsedMs);
  }
  if (times.length === 0) {
    return { note: 'rerank latency not measured: every cache-off rerank failed' };
  }
  return {
    latency: latencyOf(times),
    note: `rerank latency from a cache-off pass over ${times.length} queries`,
  };
}

function beforeRow(
  retriever: string,
  lists: readonly QueryList[],
  failedQueries: number,
  translation: Translation,
): ComparisonRow {
  return {
    retriever,
    reranker: 'none',
    model: '–',
    candidates: mean(lists.map(({ ids }) => ids.length)),
    before: gradedMeasures(lists),
    retrievalMs: latencyOf(lists.map(({ elapsedMs }) => elapsedMs)),
    ...translation,
    queries: lists.length,
    notes: failedQueries > 0 ? [`${failedQueries} queries failed`] : [],
    failed: failedQueries > 0,
  };
}

/** A reranked row; its "before" values cover the same queries as its "after" values. */
function afterRow(
  before: ComparisonRow,
  lists: readonly QueryList[],
  reranker: Reranker,
  results: readonly RerankedList[],
  { latency, note }: { latency?: Latency; note?: string },
): ComparisonRow {
  const done = new Set(results.map(({ query }) => query.id));
  const sameQueries = lists.filter(({ query }) => done.has(query.id));
  const failed = lists.length - results.length;
  return {
    ...beforeRow(before.retriever, sameQueries, 0, {
      translator: before.translator,
      translationMs: before.translationMs,
    }),
    reranker: reranker.name,
    model: reranker.model,
    after: gradedMeasures(results),
    rerankMs: latency,
    notes: [
      ...before.notes,
      ...(failed > 0 ? [`rerank failed for ${failed} queries`] : []),
      ...(note ? [note] : []),
    ],
    failed: before.failed || failed > 0 || latency === undefined,
  };
}

function skippedRow(
  before: ComparisonRow,
  reranker: string,
  reason: string,
  failed: boolean,
): ComparisonRow {
  return { ...before, reranker, queries: 0, notes: [`skipped: ${reason}`], failed };
}

/** The measures against the central chunks and against every graded chunk. */
function gradedMeasures(lists: readonly QueryList[]): GradedMeasures {
  return byGradeScope((scope) => measuresOver(lists, scope));
}

/** Macro averages over the queries of recall at each K and precision at 5 and 10. */
function measuresOver(lists: readonly QueryList[], scope: GradeScope): ListMeasures {
  const recall = (k: (ids: readonly string[]) => number) =>
    mean(lists.map(({ ids, query }) => recallAt(ids, relevantFor(query, scope), k(ids))));
  const precision = (k: number) =>
    mean(lists.map(({ ids, query }) => precisionAt(ids, relevantFor(query, scope), k)));
  return {
    '5': recall(() => 5),
    '8': recall(() => 8),
    '10': recall(() => 10),
    candidates: recall((ids) => ids.length),
    precision5: precision(5),
    precision10: precision(10),
  };
}

function rowKey(retriever: string, reranker: string): string {
  return `${retriever}\u0000${reranker}`;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
