// Builds `bench:compare`'s two flows from `.env` and the database (E5-4): the main flow as `.env`
// configures it, and the reference RAG, sharing one load of the embedder and vectors.

import type { DatabaseSync } from 'node:sqlite';
import { createEmbedder } from '../embedding/factory.js';
import type { Embedder } from '../embedding/types.js';
import type { Env } from '../env.js';
import {
  runQuery,
  type QueryFlowDependencies,
  type QueryRequest,
} from '../generation/query-flow.js';
import { formatConfiguration } from '../generation/flow-configuration.js';
import { createQueryFlow } from '../generation/setup.js';
import type { LlmLogger } from '../llm/client.js';
import { warmUpLocalModels } from '../models/warm-up.js';
import { createReferenceFlow } from '../reference/setup.js';
import { loadRetrievalResources } from '../retrieval/setup.js';
import { isRemoteReranker } from '../rerank/factory.js';
import type { BenchFlow } from './bench-compare.js';
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
): BenchSetup {
  // With the judge cache on, runs 2–5 of an `llm` or `jev` reranker would measure the cache.
  const benchEnv = { ...env, JUDGE_CACHE: 'off' };
  // Loaded once and shared, so the model loads once and the vectors are read once.
  const resources = loadRetrievalResources(db, benchEnv, embedder);
  const main = createQueryFlow(db, benchEnv, logger, {}, resources);
  const reference = createReferenceFlow(db, benchEnv, logger, {}, resources);

  return {
    flows: [
      {
        name: 'main',
        configuration: formatConfiguration(main.configuration),
        rerank: isRemoteReranker(main.reranker) ? 'remote' : 'local',
        run: (query, options) =>
          runQuery(requestFor(query), withQueryTemplate(main, query), options),
      },
      {
        name: 'reference',
        configuration: formatConfiguration(reference.configuration),
        rerank: 'none',
        run: (query, options) => runQuery(requestFor(query), reference, options),
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
