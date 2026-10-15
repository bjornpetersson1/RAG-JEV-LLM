import { readOneOf, readShare } from '../env.js';
import {
  loadSystemOneConfig,
  SYSTEM_ONE_PROVIDERS,
  type SystemOneConfig,
  type SystemOneProvider,
} from '../systemone/config.js';

const QUERY_TRANSLATOR_KINDS = ['llm', ...SYSTEM_ONE_PROVIDERS] as const;

export type QueryTranslatorConfig =
  | { impl: 'llm' }
  | {
      /** A System One model: JEV or SubQ. */
      impl: SystemOneProvider;
      /** A tag is selected when the model scores it at least this, 0–1. */
      threshold: number;
      /** The model's settings (`JEV_*` or `SUBQ_*`). */
      systemOne: SystemOneConfig;
    };

const DEFAULT_QUERY_TRANSLATOR_THRESHOLD = 0.5;

/**
 * Reads `QUERY_TRANSLATOR_IMPL` (`llm` by default) and, for `jev` or `subq`,
 * `QUERY_TRANSLATOR_THRESHOLD` and that model's settings. The LLM implementation takes its provider
 * and model from the LLM config.
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
  return {
    impl,
    threshold,
    systemOne: loadSystemOneConfig(env, impl, `QUERY_TRANSLATOR_IMPL is ${impl}`),
  };
}
