// `eval:run -- --sweep` (E7-4): how many candidates to rerank and how many to keep. For each count
// the retriever configured for it gives its own list. Every query's lists, over all counts and
// retrievers, are reranked once together; the judge scores each chunk on its own, so each list then
// keeps its chunks in that score order. Precision, recall and F1 of
// the kept chunks are measured against the central chunks and against every graded chunk.

import { describeError } from '../errors.js';
import type { Chunk } from '../llm/types.js';
import type { Reranker } from '../rerank/types.js';
import { latencyOf, type Latency } from '../stats.js';
import { averageOver, precisionRecall, type ModeScores } from './metrics.js';
import { byGradeScope, relevantFor, type GradeScope, type ResolvedQuery } from './queries.js';

export const SWEEP_CANDIDATES = [10, 20, 30, 40, 50];
export const SWEEP_TOP_K = [5, 8, 10, 12];

/** A candidate source as the sweep sees it. */
export interface SweptRetriever {
  name: string;
  /** Whether the retriever uses the query's tags (they are translated once per query). */
  usesTags: boolean;
  /** The list the retriever configured for `candidates` gives, best first. */
  retrieve(query: ResolvedQuery, tags: readonly string[], candidates: number): Promise<string[]>;
}

export interface SweepDependencies {
  retrievers: readonly SweptRetriever[];
  /** The reranker the query flow uses, keeping every relevant chunk. */
  reranker: Reranker;
  translate(query: ResolvedQuery): Promise<string[]>;
  loadChunks(ids: readonly string[]): Chunk[];
  onQuery?(query: ResolvedQuery, index: number, total: number): void;
  onFailure?(step: string, query: ResolvedQuery, error: string): void;
}

export interface CandidateSweepRow {
  retriever: string;
  candidates: number;
  topK: number;
  scores: Record<GradeScope, ModeScores>;
  /** An estimate: each query's rerank time per candidate times its number of candidates. */
  rerankMs: Latency;
  queries: number;
}

/** One query's lists for one retriever and what the reranker made of them. */
interface Swept {
  query: ResolvedQuery;
  /** The retriever's list per count. */
  lists: Map<number, string[]>;
  /** Every relevant chunk of the query's union, best first. */
  ranked: string[];
  msPerCandidate: number;
}

/** Retrieves every count for every retriever, reranks each query once, and measures each setting. */
export async function sweepCandidates(
  queries: readonly ResolvedQuery[],
  deps: SweepDependencies,
): Promise<CandidateSweepRow[]> {
  const swept = new Map<string, Swept[]>(deps.retrievers.map(({ name }) => [name, []]));
  const usesTags = deps.retrievers.some((retriever) => retriever.usesTags);

  for (const [index, query] of queries.entries()) {
    try {
      const tags = usesTags ? await deps.translate(query) : [];
      const listsOf = new Map<string, Map<number, string[]>>();
      for (const retriever of deps.retrievers) {
        const lists = new Map<number, string[]>();
        for (const candidates of SWEEP_CANDIDATES) {
          lists.set(candidates, await retriever.retrieve(query, tags, candidates));
        }
        listsOf.set(retriever.name, lists);
      }
      const union = [
        ...new Set([...listsOf.values()].flatMap((lists) => [...lists.values()].flat())),
      ];
      const chunks = deps.loadChunks(union);
      const { ranked, stats } = await deps.reranker.rerank(
        query.instruction,
        chunks,
        chunks.length,
      );
      const msPerCandidate = chunks.length > 0 ? stats.elapsedMs / chunks.length : 0;
      for (const [name, lists] of listsOf) {
        swept.get(name)?.push({
          query,
          lists,
          ranked: ranked.map(({ chunk }) => chunk.id),
          msPerCandidate,
        });
      }
    } catch (error) {
      deps.onFailure?.('sweep', query, describeError(error));
    }
    deps.onQuery?.(query, index, queries.length);
  }

  return deps.retrievers.flatMap(({ name }) => {
    const done = swept.get(name) ?? [];
    return SWEEP_CANDIDATES.flatMap((candidates) =>
      SWEEP_TOP_K.map((topK) => sweepRow(name, done, candidates, topK)),
    );
  });
}

/** What the reranker keeps of `given`: its relevant chunks in score order, at most `topK`. */
export function keptChunks(
  ranked: readonly string[],
  given: readonly string[],
  topK: number,
): string[] {
  const inList = new Set(given);
  return ranked.filter((id) => inList.has(id)).slice(0, topK);
}

function sweepRow(
  retriever: string,
  done: readonly Swept[],
  candidates: number,
  topK: number,
): CandidateSweepRow {
  const kept = done.map(({ query, lists, ranked }) => ({
    query,
    ids: keptChunks(ranked, lists.get(candidates) ?? [], topK),
  }));
  return {
    retriever,
    candidates,
    topK,
    scores: byGradeScope((scope) =>
      averageOver(kept.map(({ query, ids }) => precisionRecall(ids, relevantFor(query, scope)))),
    ),
    rerankMs: latencyOf(
      done.map(
        ({ lists, msPerCandidate }) => msPerCandidate * (lists.get(candidates)?.length ?? 0),
      ),
    ),
    queries: done.length,
  };
}

export interface SweepChoice {
  retriever: string;
  baseline: CandidateSweepRow;
  chosen: CandidateSweepRow;
}

/**
 * The spec's rule, per retriever: among the rows whose central recall is at most `recallFloor`
 * below the baseline's, the highest central F1 wins; within `tie` of it, the fewest candidates (the
 * fastest rerank), and of those the highest central F1. A retriever with no measured query gets no
 * choice.
 */
export function chooseSetting(
  rows: readonly CandidateSweepRow[],
  baselines: Readonly<Record<string, { candidates: number; topK: number }>>,
  { recallFloor = 0.03, tie = 0.01 } = {},
): SweepChoice[] {
  return Object.entries(baselines).flatMap(([retriever, { candidates, topK }]) => {
    const own = rows.filter((row) => row.retriever === retriever && row.queries > 0);
    const baseline = own.find((row) => row.candidates === candidates && row.topK === topK);
    if (!baseline) return [];
    const floor = baseline.scores.central.recall - recallFloor;
    const eligible = own.filter((row) => row.scores.central.recall >= floor);
    const best = Math.max(...eligible.map((row) => row.scores.central.f1));
    const fewest = Math.min(
      ...eligible.filter((row) => row.scores.central.f1 >= best - tie).map((row) => row.candidates),
    );
    const [chosen] = eligible
      .filter((row) => row.candidates === fewest)
      .sort((a, b) => b.scores.central.f1 - a.scores.central.f1);
    return [{ retriever, baseline, chosen }];
  });
}
