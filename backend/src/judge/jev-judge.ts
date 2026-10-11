import { JevError, type JevClient } from '../jev/client.js';
import { judgedText, relevanceQuestion } from '../llm/judge-question.js';
import type { ScoringJudge } from '../llm/types.js';

const QUESTION = 'relevant';

/** Scores a chunk with JEV: the chunk is the state, the instruction one Noul question. */
export function createJevJudge(client: JevClient): ScoringJudge {
  return {
    async judge(instruction, chunk) {
      const { answers, usage } = await client.ask(judgedText(chunk), {
        [QUESTION]: { type: 'noul', instructions: relevanceQuestion(instruction) },
      });
      const answer = answers[QUESTION];
      if (answer.type !== 'noul') throw new JevError('response', 'JEV answered without a noul');
      return { score: answer.noul, judgedBy: 'jev', usage };
    },
  };
}
