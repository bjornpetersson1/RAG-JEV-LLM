import { readOneOf, readShare } from '../env.js';
import { loadJevConfig, type JevConfig } from '../jev/config.js';

const QUERY_TRANSLATOR_KINDS = ['llm', 'jev'] as const;

export type QueryTranslatorConfig =
  | { impl: 'llm' }
  | {
      impl: 'jev';
      /** A tag is selected when JEV scores it at least this, 0–1. */
      threshold: number;
      jev: JevConfig;
    };

const DEFAULT_QUERY_TRANSLATOR_THRESHOLD = 0.5;

/**
 * Reads `QUERY_TRANSLATOR_IMPL` (`llm` by default) and, for `jev`, `QUERY_TRANSLATOR_THRESHOLD`
 * and the JEV settings. The LLM implementation takes its provider and model from the LLM config.
 */
export function loadQueryTranslatorConfig(
  env: Record<string, string | undefined>,
): QueryTranslatorConfig {
  const threshold = readShare(
    env,
    'QUERY_TRANSLATOR_THRESHOLD',
    DEFAULT_QUERY_TRANSLATOR_THRESHOLD,
  );
  const impl = readOneOf(env, 'QUERY_TRANSLATOR_IMPL', QUERY_TRANSLATOR_KINDS, 'llm');
  if (impl === 'llm') return { impl };
  return { impl, threshold, jev: loadJevConfig(env, 'QUERY_TRANSLATOR_IMPL is jev') };
}
