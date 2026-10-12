import { NO_USAGE } from '../llm/client.js';
import type { Chunk, JudgeScore } from '../llm/types.js';
import { bestFirst } from './rank.js';
import type { RerankResult, RerankStats } from './types.js';

interface FakeRerankOptions {
  /** Default: every relevant chunk. */
  topK?: number;
  answeredBy?: JudgeScore['judgedBy'];
  /** Overrides the default stats: no calls, no tokens, no time; `unknown` and `relevant` are counted. */
  stats?: Partial<RerankStats>;
}

/**
 * The result of a reranker scoring `chunks` from `scores`, relevant at 0.5 and above; a chunk
 * without a score is unknown.
 */
export function fakeRerankResult(
  chunks: readonly Chunk[],
  scores: Record<string, number>,
  { topK = chunks.length, answeredBy, stats }: FakeRerankOptions = {},
): RerankResult {
  const scored = bestFirst(
    chunks.flatMap((chunk) =>
      scores[chunk.id] === undefined
        ? []
        : [{ chunk, score: scores[chunk.id], reranker: 'fake', model: 'fake-model', answeredBy }],
    ),
  );
  const relevant = scored.filter(({ score }) => score >= 0.5);
  return {
    ranked: relevant.slice(0, topK),
    scored,
    stats: {
      calls: 0,
      cacheHits: 0,
      unknown: chunks.length - scored.length,
      relevant: relevant.length,
      usage: NO_USAGE,
      elapsedMs: 0,
      ...stats,
    },
  };
}
