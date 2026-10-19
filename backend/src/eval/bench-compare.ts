// `bench:compare` (E5-4): the main flow and the reference RAG run over the evaluation queries,
// several times each, and are summarised with the same measures: medians of total, search and LLM
// time, precision and recall of the chunks sent to the generator, and source accuracy. The flows
// are passed in, so the same code runs against the database and models or against fakes in tests.

import { randomUUID } from 'node:crypto';
import { describeError } from '../errors.js';
import { sourceAccuracy } from '../generation/post-check.js';
import type { QueryFlowName, QueryResult } from '../generation/query-flow.js';
import { latencyOf, mean, sum, type Latency } from '../stats.js';
import { averageOver, precisionRecall, type Relevance } from './metrics.js';
import type { ResolvedQuery } from './queries.js';

/** One flow as the benchmark sees it. */
export interface BenchFlow {
  name: QueryFlowName;
  /** The configuration the flow runs with, for the table. */
  configuration: string;
  /** Whether its rerank is remote (an LLM, JEV or SubQ), whose time counts as LLM time. */
  remoteRerank: boolean;
  run(query: ResolvedQuery, options: BenchRunOptions): Promise<QueryResult>;
}

export interface BenchRunOptions {
  draft: boolean;
  /** Shared by every flow's run of the same query and run, for the run log (E7-12). */
  runId: string;
  /** From 0. */
  run: number;
  runs: number;
}

export interface BenchOptions {
  /** How many times each query runs through each flow. */
  runs: number;
  /** Whether each run writes a draft; without it, generation and source accuracy are not measured. */
  draft: boolean;
  onResult?(progress: BenchProgress): void;
  onFailure?(progress: Omit<BenchProgress, 'result'> & { error: string }): void;
}

export interface BenchProgress {
  flow: QueryFlowName;
  query: ResolvedQuery;
  /** From 0. */
  run: number;
  /** The query's place in the set, from 0. */
  index: number;
  result: QueryResult;
}

export interface FlowSummary {
  flow: QueryFlowName;
  configuration: string;
  /** Absent when no run of the query set succeeded in every flow. */
  measured?: FlowMeasures;
  /** Query and run pairs measured, i.e. those that succeeded in every flow. */
  samples: number;
  /** Queries with at least one measured run. */
  queries: number;
  drafts: number;
  /** Measured pairs with no draft: the judge approved nothing. Absent when no draft was asked for. */
  withoutDraft?: number;
  runs: number;
  /** This flow's failed runs. */
  failures: number;
}

export interface FlowMeasures {
  total: Latency;
  /** The query translation, which time to sources leaves out; absent without one. */
  translation?: Latency;
  /** Time to sources: search plus rerank, without the translation (E7-8). */
  sources: Latency;
  search: Latency;
  /** Absent when the instruction was never embedded (tag search). */
  embedding?: Latency;
  /** Absent for a flow without a rerank step, like the two below. */
  rerank?: Latency;
  /** The candidates given to the rerank: the median per pair. */
  judgedCandidates?: number;
  /** Candidates the rerank could not score (a failed or timed-out call), over every pair. */
  unknown?: number;
  /**
   * Over the pairs where every flow wrote a draft (with output tokens), like the two below and
   * source accuracy, so the flows are compared on the same drafts; absent without any.
   */
  generation?: Latency;
  /** Generation time per output token, so drafts of different length compare (E7-8). */
  generationPerToken?: Latency;
  /** The drafts' output tokens. */
  outputTokens?: Latency;
  /** Query translation, generation, and a remote rerank. */
  llm: Latency;
  /** Of the chunks sent to the generator: per run a macro average over the queries, then the mean over the runs. */
  relevance: Relevance;
  /** Valid references / all references over the shared drafts; null without references. */
  sourceAccuracy: number | null;
}

interface Sample {
  run: number;
  queryId: string;
  result: QueryResult;
  relevance: Relevance;
}

/**
 * Runs every query through every flow `options.runs` times. Within a run the flows take turns
 * going first, so drift on the machine hits both. A failed run is reported, and that query and
 * run is left out of every flow, so the flows are compared on the same queries. The drafts are
 * compared only where every flow wrote one, since a judge that approves nothing writes none.
 */
export async function benchCompare(
  queries: readonly ResolvedQuery[],
  flows: readonly BenchFlow[],
  options: BenchOptions,
): Promise<FlowSummary[]> {
  const tallies = flows.map(() => ({ samples: [] as Sample[], failures: 0 }));
  const failed = new Set<string>();

  for (let run = 0; run < options.runs; run++) {
    for (const [index, query] of queries.entries()) {
      const order = flows.map((flow, i) => ({ flow, tally: tallies[i] }));
      if ((run + index) % 2 === 1) order.reverse();
      const runOptions = { draft: options.draft, runId: randomUUID(), run, runs: options.runs };
      for (const { flow, tally } of order) {
        try {
          const result = await flow.run(query, runOptions);
          const relevance = precisionRecall(sentIds(result), query.relevantIds);
          tally.samples.push({ run, queryId: query.id, result, relevance });
          options.onResult?.({ flow: flow.name, query, run, index, result });
        } catch (error) {
          tally.failures += 1;
          failed.add(pairKey(run, query.id));
          const progress = { flow: flow.name, query, run, index };
          options.onFailure?.({ ...progress, error: describeError(error) });
        }
      }
    }
  }
  const paired = tallies.map(({ samples }) =>
    samples.filter(({ run, queryId }) => !failed.has(pairKey(run, queryId))),
  );
  const drafted = paired.map(
    (samples) =>
      new Set(
        samples
          .filter(({ result }) => wroteDraft(result))
          .map(({ run, queryId }) => pairKey(run, queryId)),
      ),
  );
  const draftedByAll = new Set(
    [...(drafted[0] ?? [])].filter((key) => drafted.every((keys) => keys.has(key))),
  );
  return flows.map((flow, i) =>
    summarise(flow, paired[i], tallies[i].failures, { ...options, draftedByAll }),
  );
}

/** The chunks the generator got: what fit the context limits when a draft was asked for. */
function sentIds({ approved, draft }: QueryResult): string[] {
  const sent = draft ? [...draft.used, ...draft.unused] : approved;
  return sent.map(({ id }) => id);
}

/** A draft without text is none: no approved chunk fitted the context limits. */
function wroteDraft({ draft }: QueryResult): boolean {
  return draft?.text !== undefined;
}

function pairKey(run: number, queryId: string): string {
  return `${run}:${queryId}`;
}

interface SummaryOptions {
  runs: number;
  draft: boolean;
  /** The pairs where every flow wrote a draft. */
  draftedByAll: ReadonlySet<string>;
}

function summarise(
  flow: BenchFlow,
  samples: readonly Sample[],
  failures: number,
  options: SummaryOptions,
): FlowSummary {
  const results = samples.map(({ result }) => result);
  const drafts = results.filter(wroteDraft).length;
  return {
    flow: flow.name,
    configuration: flow.configuration,
    ...(results.length > 0 && { measured: measure(flow, samples, options) }),
    samples: samples.length,
    queries: new Set(samples.map(({ queryId }) => queryId)).size,
    drafts,
    ...(options.draft && { withoutDraft: samples.length - drafts }),
    runs: options.runs,
    failures,
  };
}

function measure(
  flow: BenchFlow,
  samples: readonly Sample[],
  { runs, draftedByAll }: SummaryOptions,
): FlowMeasures {
  const results = samples.map(({ result }) => result);
  const shared = samples
    .filter(({ run, queryId }) => draftedByAll.has(pairKey(run, queryId)))
    .map(({ result }) => result);
  const judged = results.filter(({ judging }) => judging);
  const checks = shared.flatMap(({ draft }) => (draft?.check ? [draft.check] : []));
  const latencyIfAny = (times: readonly number[]) =>
    times.length > 0 ? latencyOf(times) : undefined;
  const optional = (step: 'translationMs' | 'embeddingMs' | 'judgingMs') =>
    latencyIfAny(results.flatMap(({ timings }) => timings[step] ?? []));
  const drafts = shared.flatMap(({ timings, usage }) =>
    timings.generationMs !== undefined && usage.generation && usage.generation.outputTokens > 0
      ? [{ ms: timings.generationMs, tokens: usage.generation.outputTokens }]
      : [],
  );
  return {
    total: latencyOf(results.map(({ timings }) => timings.totalMs)),
    translation: optional('translationMs'),
    sources: latencyOf(results.map(({ timings }) => timings.sourcesMs)),
    search: latencyOf(results.map(({ timings }) => timings.searchMs)),
    embedding: optional('embeddingMs'),
    rerank: optional('judgingMs'),
    ...(judged.length > 0 && {
      // The rerank is given the candidates that loaded, which are the sources.
      judgedCandidates: latencyOf(judged.map(({ sources }) => sources.length)).median,
      unknown: sum(judged.map(({ judging }) => judging?.unknown ?? 0)),
    }),
    generation: latencyIfAny(drafts.map(({ ms }) => ms)),
    generationPerToken: latencyIfAny(drafts.map(({ ms, tokens }) => ms / tokens)),
    outputTokens: latencyIfAny(drafts.map(({ tokens }) => tokens)),
    llm: latencyOf(results.map((result) => llmMs(result, flow.remoteRerank))),
    relevance: averageOverRuns(samples, runs),
    sourceAccuracy: sourceAccuracy(
      sum(checks.map(({ valid }) => valid)),
      sum(checks.map(({ references }) => references)),
    ),
  };
}

/** The time spent waiting for an LLM, JEV or SubQ. */
function llmMs({ timings }: QueryResult, remoteRerank: boolean): number {
  return (
    (timings.translationMs ?? 0) +
    (timings.generationMs ?? 0) +
    (remoteRerank ? (timings.judgingMs ?? 0) : 0)
  );
}

/** Each run's macro average over its queries, then the mean over the runs that have any. */
function averageOverRuns(samples: readonly Sample[], runs: number): Relevance {
  const perRun = Array.from({ length: runs }, (_, run) =>
    samples.filter((sample) => sample.run === run).map(({ relevance }) => relevance),
  ).filter((rows) => rows.length > 0);
  const averages = perRun.map((rows) => averageOver(rows));
  return {
    precision: mean(averages.map(({ precision }) => precision)),
    recall: mean(averages.map(({ recall }) => recall)),
  };
}
