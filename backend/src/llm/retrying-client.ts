import {
  LlmError,
  type LlmClient,
  type LlmLogger,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from './client.js';
import { estimateCostUsd } from './pricing.js';
import type { RoleName } from './types.js';

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** One request to a provider; throws `LlmError` to say whether a retry may help. */
export type LlmAttempt = (request: LlmRequest) => Promise<LlmResponse>;

export interface RetryAndLogOptions {
  role: RoleName;
  provider: string;
  model: string;
  maxRetries: number;
  logger: LlmLogger;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Provider-independent call policy: retries retryable failures with backoff and logs exactly one
 * entry per call (role, provider, model, latency, attempts, tokens and estimated cost).
 */
export function withRetryAndLogging(attempt: LlmAttempt, options: RetryAndLogOptions): LlmClient {
  const { role, provider, model, maxRetries, logger } = options;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async complete(request) {
      const started = performance.now();
      const callFields = (attempts: number) => ({
        role,
        provider,
        model,
        latencyMs: Math.round(performance.now() - started),
        attempts,
      });

      for (let attempts = 1; ; attempts += 1) {
        try {
          const result = await attempt(request);
          logger.info({ ...callFields(attempts), ...usageFields(model, result.usage) }, 'LLM call');
          return result;
        } catch (error) {
          const llmError = toLlmError(error);
          const waitMs = llmError.retryAfterMs ?? backoffMs(attempts);
          // A server asking for a longer wait than the cap is not worth blocking the caller for.
          if (llmError.retryable && attempts <= maxRetries && waitMs <= MAX_BACKOFF_MS) {
            await sleep(waitMs);
            continue;
          }
          logger.error(
            {
              ...callFields(attempts),
              ...usageFields(model, llmError.usage),
              error: llmError.message,
            },
            'LLM call failed',
          );
          throw llmError;
        }
      }
    },
  };
}

function usageFields(model: string, usage: LlmUsage | undefined) {
  return usage ? { ...usage, costUsd: estimateCostUsd(model, usage) } : {};
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  return new LlmError(error instanceof Error ? error.message : String(error), {
    retryable: false,
  });
}

function backoffMs(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return exponential / 2 + Math.random() * (exponential / 2);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
