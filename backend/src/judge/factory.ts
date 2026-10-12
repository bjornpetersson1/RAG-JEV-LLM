import { createJevClient } from '../jev/client.js';
import type { LlmLogger } from '../llm/client.js';
import { roleModel, type LlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import type { Judge, ScoringJudge } from '../llm/types.js';
import type { JudgeConfig } from './config.js';
import { createFallbackJudge } from './fallback-judge.js';
import { createJevJudge } from './jev-judge.js';

/** The judge whose scores are cached: JEV for `jev` (not its LLM fallback), else the LLM. */
export interface PrimaryJudge {
  impl: 'jev' | 'llm';
  model: string;
}

/** What `judgeAll` needs, built from one config so the judge, cache key and threshold agree. */
export interface Judging {
  judge: ScoringJudge;
  primary: PrimaryJudge;
  /** `JUDGE_THRESHOLD`. */
  threshold: number;
}

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
    async judge(instruction, chunk, signal) {
      const judgement = await scoring.judge(instruction, chunk, signal);
      return { ...judgement, relevant: isRelevant(judgement.score, config.threshold) };
    },
  };
}

export interface JudgingDependencies {
  /** The LLM config the judge's LLM (and its model in the cache key) comes from. */
  llmConfig: LlmConfig;
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/**
 * The judge `config` selects, unthresholded, with its cache identity. The LLM judge and the model
 * in the key both come from `llmConfig`, so they cannot disagree.
 */
export function createJudging(
  config: JudgeConfig,
  { llmConfig, logger, fetch }: JudgingDependencies,
): Judging {
  const llmJudge = createLlmRoles(llmConfig, { logger, fetch }).judge;
  return {
    judge: scoringJudge(config, { llmJudge, logger, fetch }),
    primary:
      config.impl === 'llm'
        ? { impl: 'llm', model: roleModel(llmConfig, 'judge') }
        : { impl: 'jev', model: config.jev.model },
    threshold: config.threshold,
  };
}

/** The one relevance rule: a score at or above the threshold. */
export function isRelevant(score: number, threshold: number): boolean {
  return score >= threshold;
}

function scoringJudge(
  config: JudgeConfig,
  { llmJudge, logger, fetch }: JudgeDependencies,
): ScoringJudge {
  if (config.impl === 'llm') return llmJudge;
  const jevJudge = createJevJudge(createJevClient({ ...config.jev, role: 'judge', logger, fetch }));
  return createFallbackJudge(jevJudge, llmJudge, logger);
}
