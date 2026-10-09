export type JsonSchema = Record<string, unknown>;

export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON schema the response must follow; objects need `additionalProperties: false`. */
  schema: JsonSchema;
  maxTokens?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
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
