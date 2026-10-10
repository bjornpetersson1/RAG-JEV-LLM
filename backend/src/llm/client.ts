export type JsonSchema = Record<string, unknown>;

export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON schema the response must follow; objects need `additionalProperties: false`. */
  schema: JsonSchema;
  maxTokens?: number;
  /**
   * Marks the system prompt for prompt caching, for a long system prompt that many calls repeat
   * unchanged (e.g. the tag vocabulary).
   */
  cacheSystem?: boolean;
}

export interface LlmUsage {
  /** Input tokens billed at the normal rate, i.e. not written to or read from the cache. */
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export const NO_USAGE: LlmUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
});

/** The token counts of `usages` added up. */
export function sumUsage(usages: readonly LlmUsage[]): LlmUsage {
  return usages.reduce(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
      cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
    }),
    NO_USAGE,
  );
}

export interface LlmResponse {
  data: unknown;
  usage: LlmUsage;
}

/** Low-level client bound to one role and one model. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Structural subset of Fastify's (pino) logger, so `app.log` can be passed directly. */
export interface LlmLogger {
  info(entry: object, message: string): void;
  error(entry: object, message: string): void;
}

export interface LlmErrorDetails {
  retryable: boolean;
  /** Server-requested wait before retrying. */
  retryAfterMs?: number;
  /** Tokens billed for a response that was received but could not be used. */
  usage?: LlmUsage;
}

export class LlmError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly usage?: LlmUsage;

  constructor(message: string, details: LlmErrorDetails) {
    super(message);
    this.name = 'LlmError';
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
    this.usage = details.usage;
  }
}
