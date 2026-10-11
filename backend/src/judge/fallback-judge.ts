import { JevError } from '../jev/client.js';
import type { LlmLogger } from '../llm/client.js';
import type { ScoringJudge } from '../llm/types.js';

/**
 * Asks `jev` and, when JEV fails for any reason but a cancellation, `llm` instead, logging a
 * warning. A cancellation, any other error and the LLM's own failure are thrown.
 */
export function createFallbackJudge(
  jev: ScoringJudge,
  llm: ScoringJudge,
  logger: LlmLogger,
): ScoringJudge {
  return {
    async judge(instruction, chunk, signal) {
      try {
        return await jev.judge(instruction, chunk, signal);
      } catch (error) {
        if (!(error instanceof JevError) || error.kind === 'aborted') throw error;
        logger.warn(
          { role: 'judge', chunkId: chunk.id, kind: error.kind, error: error.message },
          'JEV failed, judging with the LLM instead',
        );
        return llm.judge(instruction, chunk, signal);
      }
    },
  };
}
