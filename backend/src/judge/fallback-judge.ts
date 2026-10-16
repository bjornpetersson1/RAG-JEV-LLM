import type { LlmLogger } from '../llm/client.js';
import type { ScoringJudge } from '../llm/types.js';
import { SystemOneError } from '../systemone/client.js';
import { PROVIDER_NAMES } from '../systemone/config.js';

/**
 * Asks `model` (JEV or SubQ) and, when it fails for any reason but a cancellation, `llm` instead,
 * logging a warning that names the model. A cancellation, any other error and the LLM's own failure
 * are thrown.
 */
export function createFallbackJudge(
  model: ScoringJudge,
  llm: ScoringJudge,
  logger: LlmLogger,
): ScoringJudge {
  return {
    async judge(instruction, chunk, signal) {
      try {
        return await model.judge(instruction, chunk, signal);
      } catch (error) {
        if (!(error instanceof SystemOneError) || error.kind === 'aborted') throw error;
        logger.warn(
          { role: 'judge', chunkId: chunk.id, kind: error.kind, error: error.message },
          `${PROVIDER_NAMES[error.provider]} failed, judging with the LLM instead`,
        );
        return llm.judge(instruction, chunk, signal);
      }
    },
  };
}
