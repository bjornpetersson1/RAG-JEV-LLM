import { readPositiveInteger } from '../env.js';
import { MAX_TIMER_MS } from '../http.js';

/** The System One providers: TypeSafe's JEV and Subquadratic's SubQ, which share one API shape. */
export const SYSTEM_ONE_PROVIDERS = ['jev', 'subq'] as const;

export type SystemOneProvider = (typeof SYSTEM_ONE_PROVIDERS)[number];

/** Each provider's name in messages and logs. */
export const PROVIDER_NAMES: Record<SystemOneProvider, string> = { jev: 'JEV', subq: 'SubQ' };

export interface SystemOneConfig {
  apiKey: string;
  /** The API root, e.g. `https://api.typesafe.ai/v1`; requests go to `<baseUrl>/systemone`. */
  baseUrl: string;
  /** The model to ask, e.g. `jev-latest`. */
  model: string;
  timeoutMs: number;
}

// Each answers short questions; a call this slow is treated as failed rather than waited for.
const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULTS: Record<SystemOneProvider, { baseUrl: string; model: string }> = {
  jev: { baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-latest' },
  // https://docs.subq.ai/using-the-api/models/: the decision model, in public preview.
  subq: { baseUrl: 'https://api.subq.ai/v1', model: 'subq-snap-preview' },
};

/** The settings' prefix, e.g. `JEV` for `JEV_API_KEY`. */
function prefix(provider: SystemOneProvider): string {
  return provider.toUpperCase();
}

/** The provider's key setting, e.g. `SUBQ_API_KEY`. */
export function apiKeyName(provider: SystemOneProvider): string {
  return `${prefix(provider)}_API_KEY`;
}

/** Whether `<PROVIDER>_API_KEY` is set, i.e. whether the provider can be called at all. */
export function hasSystemOneKey(
  env: Record<string, string | undefined>,
  provider: SystemOneProvider,
): boolean {
  return apiKey(env, provider) !== undefined;
}

/** The trimmed `<PROVIDER>_API_KEY`, or undefined when it is unset or blank. */
function apiKey(
  env: Record<string, string | undefined>,
  provider: SystemOneProvider,
): string | undefined {
  return env[apiKeyName(provider)]?.trim() || undefined;
}

/**
 * Reads `<PROVIDER>_API_KEY`, `_BASE_URL`, `_MODEL` and `_TIMEOUT_MS`, e.g. `JEV_API_KEY`;
 * `requiredBy` names what needs the provider, for the error when the key is missing. A caller with
 * its own timeout setting passes `timeoutMs`, which replaces `<PROVIDER>_TIMEOUT_MS`.
 */
export function loadSystemOneConfig(
  env: Record<string, string | undefined>,
  provider: SystemOneProvider,
  requiredBy: string,
  timeoutMs?: number,
): SystemOneConfig {
  const name = prefix(provider);
  const key = apiKey(env, provider);
  if (!key) throw new Error(`${apiKeyName(provider)} is required because ${requiredBy}`);
  // Read even when overridden, so an invalid value fails at startup whichever role uses it.
  const ownTimeoutMs = readPositiveInteger(
    env,
    `${name}_TIMEOUT_MS`,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMER_MS,
  );
  const baseUrl = env[`${name}_BASE_URL`]?.trim() || DEFAULTS[provider].baseUrl;
  if (!URL.canParse(baseUrl)) {
    throw new Error(`Invalid ${name}_BASE_URL "${baseUrl}": expected a URL`);
  }
  return {
    apiKey: key,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: env[`${name}_MODEL`]?.trim() || DEFAULTS[provider].model,
    timeoutMs: timeoutMs ?? ownTimeoutMs,
  };
}
