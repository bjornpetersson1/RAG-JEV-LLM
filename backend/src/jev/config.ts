import { readPositiveInteger } from '../env.js';

export interface JevConfig {
  apiKey: string;
  /** The API root, e.g. `https://api.typesafe.ai/v1`; requests go to `<baseUrl>/systemone`. */
  baseUrl: string;
  /** The JEV model to ask, e.g. `jev-latest`. */
  model: string;
  timeoutMs: number;
}

const DEFAULT_JEV_SETTINGS = {
  baseUrl: 'https://api.typesafe.ai/v1',
  model: 'jev-latest',
  // JEV answers short questions; a call this slow is treated as failed rather than waited for.
  timeoutMs: 30_000,
} as const;

/**
 * Reads `JEV_API_KEY`, `JEV_BASE_URL`, `JEV_MODEL` and `JEV_TIMEOUT_MS`; `requiredBy` names what
 * needs JEV, for the error when the key is missing.
 */
export function loadJevConfig(
  env: Record<string, string | undefined>,
  requiredBy: string,
): JevConfig {
  const apiKey = env.JEV_API_KEY?.trim();
  if (!apiKey) throw new Error(`JEV_API_KEY is required because ${requiredBy}`);
  const baseUrl = env.JEV_BASE_URL?.trim() || DEFAULT_JEV_SETTINGS.baseUrl;
  if (!URL.canParse(baseUrl)) throw new Error(`Invalid JEV_BASE_URL "${baseUrl}": expected a URL`);
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: env.JEV_MODEL?.trim() || DEFAULT_JEV_SETTINGS.model,
    timeoutMs: readPositiveInteger(env, 'JEV_TIMEOUT_MS', DEFAULT_JEV_SETTINGS.timeoutMs),
  };
}
