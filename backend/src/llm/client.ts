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
/** A logger that drops everything, for scripts that print their own output. */
export const SILENT_LOGGER: LlmLogger = { info() {}, warn() {}, error() {} };

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

/** The token counts as the Anthropic API (and the Claude Code CLI) report them. */
export interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** `usage` as {@link LlmUsage}; a missing count is 0. */
export function toLlmUsage(usage: ApiUsage | undefined): LlmUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
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
  warn(entry: object, message: string): void;
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
