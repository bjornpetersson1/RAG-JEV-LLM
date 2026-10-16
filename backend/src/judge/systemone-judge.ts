import { SystemOneError, type SystemOneClient } from '../systemone/client.js';
import { PROVIDER_NAMES } from '../systemone/config.js';
import { judgedText, relevanceQuestion } from '../llm/judge-question.js';
import type { ScoringJudge } from '../llm/types.js';

const QUESTION = 'relevant';

/**
 * Scores a chunk with a System One model (JEV or SubQ): the chunk is the state, the instruction one
 * Noul question.
 */
export function createSystemOneJudge(client: SystemOneClient): ScoringJudge {
  const { provider } = client;
  return {
    async judge(instruction, chunk, signal) {
      const { answers, usage } = await client.ask(
        judgedText(chunk),
        { [QUESTION]: { type: 'noul', instructions: relevanceQuestion(instruction) } },
        signal,
      );
      const answer = answers[QUESTION];
      if (answer.type !== 'noul') {
        throw new SystemOneError(
          provider,
          'response',
          `${PROVIDER_NAMES[provider]} answered without a noul`,
        );
      }
      return { score: answer.noul, judgedBy: provider, usage };
    },
  };
}
