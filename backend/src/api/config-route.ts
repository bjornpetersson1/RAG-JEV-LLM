// `GET /config` (E7-14): what the UI says about the comparison before a query runs. The judges of
// the two flows and the judge cache, read from `.env` without building a flow, so it answers also
// without a database.

import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import { loadJudgingConfig } from '../judge/config.js';
import { REFERENCE_RERANKER } from '../reference/config.js';
import { loadRerankerConfig } from '../rerank/factory.js';

export interface AppConfig {
  /** Each flow's judge as its `RERANKER` value; the reference RAG's is always the LLM. */
  judges: { main: { name: string }; reference: { name: string } };
  /** `JUDGE_CACHE`: whether judge scores are saved and reused. */
  judgeCache: boolean;
}

/** Registers `GET /config`, read once from `env` (validated at startup). */
export function registerConfigRoute(app: FastifyInstance, env: Env = process.env): void {
  const config: AppConfig = {
    judges: {
      main: { name: loadRerankerConfig(env).name },
      reference: { name: REFERENCE_RERANKER },
    },
    judgeCache: loadJudgingConfig(env).cache,
  };
  app.get('/config', async () => config);
}
