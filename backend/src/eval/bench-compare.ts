// `bench:compare` (E5-4): the main flow and the reference RAG run over the evaluation queries,
// several times each, and are summarised with the same measures: medians of total, search and LLM
// time, precision and recall of the chunks sent to the generator, and source accuracy. The flows
// are passed in, so the same code runs against the database and models or against fakes in tests.

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
  /** Whether its rerank is remote (an LLM or JEV), whose time counts as LLM time. */
  remoteRerank: boolean;
  run(query: ResolvedQuery, options: { draft: boolean }): Promise<QueryResult>;
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
  runs: number;
  /** This flow's failed runs. */
  failures: number;
}

export interface FlowMeasures {
  total: Latency;
  search: Latency;
  /** Absent when the instruction was never embedded (tag search). */
  embedding?: Latency;
  /** Absent for a flow without a rerank step. */
  rerank?: Latency;
  /** Absent when no draft was written. */
  generation?: Latency;
  /** Query translation, generation, and a remote rerank. */
  llm: Latency;
  /** Of the chunks sent to the generator: per run a macro average over the queries, then the mean over the runs. */
  relevance: Relevance;
  /** Valid references / all references over every draft; null without references. */
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
 * run is left out of every flow, so the flows are compared on the same queries.
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
      for (const { flow, tally } of order) {
        try {
          const result = await flow.run(query, { draft: options.draft });
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
  return flows.map((flow, i) => {
    const paired = tallies[i].samples.filter(
      ({ run, queryId }) => !failed.has(pairKey(run, queryId)),
    );
    return summarise(flow, paired, tallies[i].failures, options.runs);
  });
}

/** The chunks the generator got: what fit the context limits when a draft was asked for. */
function sentIds({ approved, draft }: QueryResult): string[] {
  const sent = draft ? [...draft.used, ...draft.unused] : approved;
  return sent.map(({ id }) => id);
}

function pairKey(run: number, queryId: string): string {
  return `${run}:${queryId}`;
}

function summarise(
  flow: BenchFlow,
  samples: readonly Sample[],
  failures: number,
  runs: number,
): FlowSummary {
  const results = samples.map(({ result }) => result);
  return {
    flow: flow.name,
    configuration: flow.configuration,
    ...(results.length > 0 && { measured: measure(flow, samples, runs) }),
    samples: samples.length,
    queries: new Set(samples.map(({ queryId }) => queryId)).size,
    drafts: results.filter(({ draft }) => draft?.text !== undefined).length,
    runs,
    failures,
  };
}

function measure(flow: BenchFlow, samples: readonly Sample[], runs: number): FlowMeasures {
  const results = samples.map(({ result }) => result);
  const checks = results.flatMap(({ draft }) => (draft?.check ? [draft.check] : []));
  const optional = (step: 'embeddingMs' | 'judgingMs' | 'generationMs') => {
    const times = results.flatMap(({ timings }) => timings[step] ?? []);
    return times.length > 0 ? latencyOf(times) : undefined;
  };
  return {
    total: latencyOf(results.map(({ timings }) => timings.totalMs)),
    search: latencyOf(results.map(({ timings }) => timings.searchMs)),
    embedding: optional('embeddingMs'),
    rerank: optional('judgingMs'),
    generation: optional('generationMs'),
    llm: latencyOf(results.map((result) => llmMs(result, flow.remoteRerank))),
    relevance: averageOverRuns(samples, runs),
    sourceAccuracy: sourceAccuracy(
      sum(checks.map(({ valid }) => valid)),
      sum(checks.map(({ references }) => references)),
    ),
  };
}

/** The time spent waiting for an LLM or JEV. */
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
