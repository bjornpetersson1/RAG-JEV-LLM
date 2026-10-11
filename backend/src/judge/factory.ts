import { createJevClient } from '../jev/client.js';
import type { LlmLogger } from '../llm/client.js';
import type { Judge, ScoringJudge } from '../llm/types.js';
import type { JudgeConfig } from './config.js';
import { createFallbackJudge } from './fallback-judge.js';
import { createJevJudge } from './jev-judge.js';

export interface JudgeDependencies {
  /** The LLM roles' judge (Anthropic or fake, per the LLM config). */
  llmJudge: ScoringJudge;
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/** The judge `config` selects; whichever judge answers, `config.threshold` decides relevance. */
export function createJudge(
  config: JudgeConfig,
  { llmJudge, logger, fetch }: JudgeDependencies,
): Judge {
  const scoring = scoringJudge(config, { llmJudge, logger, fetch });
  return {
    async judge(instruction, chunk) {
      const judgement = await scoring.judge(instruction, chunk);
      return { ...judgement, relevant: judgement.score >= config.threshold };
    },
  };
}

function scoringJudge(
  config: JudgeConfig,
  { llmJudge, logger, fetch }: JudgeDependencies,
): ScoringJudge {
  if (config.impl === 'llm') return llmJudge;
  const jevJudge = createJevJudge(createJevClient({ ...config.jev, role: 'judge', logger, fetch }));
  return config.impl === 'jev' ? jevJudge : createFallbackJudge(jevJudge, llmJudge, logger);
}
