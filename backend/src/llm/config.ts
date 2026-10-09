import { ROLE_NAMES, type RoleName } from './types.js';

const PROVIDERS = ['anthropic', 'fake'] as const;

type Provider = (typeof PROVIDERS)[number];

export type RoleConfig =
  { provider: 'anthropic'; model: string; apiKey: string } | { provider: 'fake' };

export interface LlmConfig {
  roles: Record<RoleName, RoleConfig>;
  timeoutMs: number;
  maxRetries: number;
}

// Generous like the Anthropic SDK's default: long drafts with adaptive thinking can take minutes.
export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_RETRIES = 2;

interface IntegerRange {
  min: number;
  max: number;
}

// Node timers (and so AbortSignal.timeout) cannot represent delays above 2^31 - 1 ms.
const TIMEOUT_RANGE: IntegerRange = { min: 1, max: 2 ** 31 - 1 };
const RETRIES_RANGE: IntegerRange = { min: 0, max: 10 };

const ROLE_ENV_KEYS: Record<RoleName, string> = {
  tagger: 'TAGGER',
  queryTranslator: 'QUERY_TRANSLATOR',
  judge: 'JUDGE',
  generator: 'GENERATOR',
};

export class LlmConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid LLM configuration in .env:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'LlmConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Reads and validates the LLM settings; throws one `LlmConfigError` listing every problem. */
export function loadLlmConfig(env: Env): LlmConfig {
  const issues: string[] = [];
  const read = (key: string) => {
    const value = env[key]?.trim();
    return value === '' ? undefined : value;
  };

  /** The integer at `key` within `range`, the fallback when unset; records an issue when invalid. */
  function readInteger(key: string, fallback: number, range: IntegerRange): number {
    const value = read(key);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= range.min && parsed <= range.max) return parsed;
    issues.push(`${key} must be an integer from ${range.min} to ${range.max}, got "${value}"`);
    return fallback;
  }

  const defaultProvider = read('LLM_PROVIDER');
  if (defaultProvider === undefined) {
    issues.push(`LLM_PROVIDER is required (expected one of: ${PROVIDERS.join(', ')})`);
  } else if (!isProvider(defaultProvider)) {
    issues.push(unsupportedProvider('LLM_PROVIDER', defaultProvider));
  }

  const apiKey = read('ANTHROPIC_API_KEY');
  const anthropicRoles: RoleName[] = [];
  const roles = {} as Record<RoleName, RoleConfig>;
  for (const role of ROLE_NAMES) {
    const providerKey = `LLM_${ROLE_ENV_KEYS[role]}_PROVIDER`;
    const modelKey = `LLM_${ROLE_ENV_KEYS[role]}_MODEL`;
    const override = read(providerKey);
    if (override !== undefined && !isProvider(override)) {
      issues.push(unsupportedProvider(providerKey, override));
      continue;
    }

    const provider = override ?? defaultProvider;
    if (provider === 'fake') {
      roles[role] = { provider };
    } else if (provider === 'anthropic') {
      anthropicRoles.push(role);
      const model = read(modelKey) ?? read('LLM_MODEL');
      if (model === undefined) {
        issues.push(`${modelKey} or LLM_MODEL is required because ${role} uses provider anthropic`);
      } else if (apiKey !== undefined) {
        roles[role] = { provider, model, apiKey };
      }
    }
  }
  if (anthropicRoles.length > 0 && apiKey === undefined) {
    issues.push(
      `ANTHROPIC_API_KEY is required because ${anthropicRoles.join(', ')} use provider anthropic`,
    );
  }

  const timeoutMs = readInteger('LLM_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, TIMEOUT_RANGE);
  const maxRetries = readInteger('LLM_MAX_RETRIES', DEFAULT_MAX_RETRIES, RETRIES_RANGE);

  if (issues.length > 0) throw new LlmConfigError(issues);
  return { roles, timeoutMs, maxRetries };
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function unsupportedProvider(key: string, value: string): string {
  return `${key} "${value}" is not supported (expected one of: ${PROVIDERS.join(', ')})`;
}
