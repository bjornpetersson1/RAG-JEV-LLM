// Builds `bench:compare`'s two flows from `.env` and the database (E5-4): the main flow as `.env`
// configures it, and the reference RAG, sharing one load of the embedder and vectors and, with
// `RERANKER=llm`, one LLM judge (E7-9). Every run is written to the run log as a `bench` run (E7-12).

import type { DatabaseSync } from 'node:sqlite';
import { createEmbedder } from '../embedding/factory.js';
import type { Embedder } from '../embedding/types.js';
import type { Env } from '../env.js';
import type { QueryFlowDependencies, QueryRequest } from '../generation/query-flow.js';
import { formatConfiguration } from '../generation/flow-configuration.js';
import { createRunLog, runAndLog, type LoggedRun, type RunLog } from '../generation/run-log.js';
import { createQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { warmUpLocalModels } from '../models/warm-up.js';
import { createReferenceFlow } from '../reference/setup.js';
import { loadRetrievalResources } from '../retrieval/setup.js';
import { isRemoteReranker } from '../rerank/factory.js';
import type { BenchFlow, BenchRunOptions } from './bench-compare.js';
import type { ResolvedQuery } from './queries.js';

export interface BenchSetup {
  flows: BenchFlow[];
  /** Loads the embedder and a local reranker before anything is timed. */
  warmUp(): Promise<void>;
}

export function createBenchSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  /** A fake embedder in tests; by default `EMBEDDER`. */
  embedder: Embedder = createEmbedder(env),
  /** A temporary log in tests; by default `logs/runs.jsonl`, warning on stderr. */
  log: RunLog = createRunLog((message) => console.warn(message)),
): BenchSetup {
  // With the judge cache on, runs 2–5 of an `llm`, `subq` or `jev` reranker would measure the cache.
  const benchEnv = { ...env, JUDGE_CACHE: 'off' };
  // Loaded once and shared, so the model loads once and the vectors are read once.
  const resources = loadRetrievalResources(db, benchEnv, embedder);
  const main = createQueryFlow(db, benchEnv, logger, {}, resources);
  const reference = createReferenceFlow(db, benchEnv, logger, {}, resources, main.reranker);

  return {
    flows: [
      {
        name: 'main',
        configuration: formatConfiguration(main.configuration),
        remoteRerank: isRemoteReranker(main.reranker),
        run: (query, options) =>
          runAndLog(requestFor(query), withQueryTemplate(main, query), logged(log, query, options)),
      },
      {
        name: 'reference',
        configuration: formatConfiguration(reference.configuration),
        remoteRerank: isRemoteReranker(reference.reranker),
        run: (query, options) =>
          runAndLog(requestFor(query), reference, logged(log, query, options)),
      },
    ],
    warmUp: () => warmUpLocalModels(db, embedder, [main.reranker]),
  };
}

/**
 * The query's contract picks the prompt template. `QueryRequest.template` also adds preset tags in
 * translation, which only a query that chose a template should get, so `withQueryTemplate` gives
 * that step the query's own template, as E5-3's evaluation translates.
 */
function requestFor(query: ResolvedQuery): QueryRequest {
  return { instruction: query.instruction, template: query.kind };
}

function withQueryTemplate(
  flow: QueryFlowDependencies,
  query: ResolvedQuery,
): QueryFlowDependencies {
  const { translate } = flow;
  if (!translate) return flow;
  return { ...flow, translate: (input) => translate({ ...input, template: query.template }) };
}

/** A bench run as the run log records it: which query and run, under the pair's `runId`. */
function logged(
  log: RunLog,
  query: ResolvedQuery,
  { draft, runId, run, runs }: BenchRunOptions,
): LoggedRun {
  return {
    draft,
    log,
    source: 'bench',
    runId,
    bench: { queryId: query.id, run: run + 1, runs },
  };
}
