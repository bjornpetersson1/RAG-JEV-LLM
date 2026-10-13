// The `jev` and `llm` rerankers: E5-1's judges run through E5-2's `judgeAll`, so concurrency,
// timeouts and the judge cache work as before, and `JUDGE_THRESHOLD` decides relevance.

import { loadJudgeConfig, loadJudgingConfig, type JudgeImpl } from '../judge/config.js';
import { createJudging } from '../judge/factory.js';
import { judgeAll, type JudgeAllResult } from '../judge/judge-all.js';
import { roleModel } from '../llm/config.js';
import type { Chunk, JudgeScore } from '../llm/types.js';
import { bestFirst } from './rank.js';
import type { RerankResult, RerankerEntry, ScoredChunk } from './types.js';

/** JEV, and the judge's LLM when a JEV call fails; requires `JEV_API_KEY`. */
export const jevReranker = judgeReranker('jev');

/** The LLM judge (`LLM_JUDGE_*`). */
export const llmReranker = judgeReranker('llm');

function judgeReranker(impl: JudgeImpl): RerankerEntry {
  return {
    remote: true,
    validate(env) {
      loadJudgeConfig(env, impl);
      loadJudgingConfig(env);
    },
    create(env, { db, llmConfig, logger, fetch }) {
      const judging = createJudging(loadJudgeConfig(env, impl), { llmConfig, logger, fetch });
      const config = loadJudgingConfig(env);
      const { model } = judging.primary;
      // A chunk the LLM scored for a failed JEV call names the LLM's model, not JEV's.
      const models = { jev: model, llm: roleModel(llmConfig, 'judge') };
      return {
        name: impl,
        model,
        async rerank(query, chunks, topK) {
          const judged = await judgeAll(query, chunks, { judging, config, db, logger });
          const scored = bestFirst(toScored(judged, chunks, impl, models));
          // judgeAll has applied JUDGE_THRESHOLD.
          const relevant = new Set(judged.relevant);
          return {
            judged: true,
            ranked: scored.filter(({ chunk }) => relevant.has(chunk)).slice(0, topK),
            scored,
            stats: {
              calls: judged.judgeCalls,
              cacheHits: judged.cacheHits,
              unknown: judged.unknown,
              relevant: relevant.size,
              usage: judged.usage,
              elapsedMs: judged.elapsedMs,
            },
          } satisfies RerankResult;
        },
      };
    },
  };
}

/** The judged and cached chunks, in candidate order; unknown chunks have no score. */
function toScored(
  judged: JudgeAllResult,
  chunks: readonly Chunk[],
  reranker: string,
  models: Record<JudgeScore['judgedBy'], string>,
): ScoredChunk[] {
  return judged.judgements.flatMap((judgement, i) =>
    judgement.status === 'unknown'
      ? []
      : [
          {
            chunk: chunks[i],
            score: judgement.score,
            reranker,
            model: models[judgement.judgedBy],
            answeredBy: judgement.judgedBy,
          },
        ],
  );
}
