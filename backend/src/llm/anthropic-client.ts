import {
  LlmError,
  type LlmClient,
  type LlmLogger,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from './client.js';
import { withRetryAndLogging } from './retrying-client.js';
import type { RoleName } from './types.js';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 16_000;

export interface AnthropicClientOptions {
  role: RoleName;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  logger: LlmLogger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface MessagesResponse {
  content?: unknown;
  stop_reason?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export function createAnthropicClient(options: AnthropicClientOptions): LlmClient {
  const { model, apiKey, timeoutMs } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;

  // Only the HTTP exchange is wrapped, so that a timeout or dropped connection while reading the
  // body is retried like one during the request, while response-shape errors are not.
  async function fetchMessage(body: string): Promise<unknown> {
    try {
      const response = await fetchFn(MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw await httpError(response);
      return await response.json();
    } catch (error) {
      throw classifyTransportError(error, timeoutMs);
    }
  }

  async function attempt(request: LlmRequest): Promise<LlmResponse> {
    const body = JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.cacheSystem
        ? [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }]
        : request.system,
      messages: [{ role: 'user', content: request.prompt }],
      output_config: { format: { type: 'json_schema', schema: request.schema } },
    });
    return parseMessage(await fetchMessage(body));
  }

  return withRetryAndLogging(attempt, {
    role: options.role,
    provider: 'anthropic',
    model,
    maxRetries: options.maxRetries,
    logger: options.logger,
    sleep: options.sleep,
  });
}

function classifyTransportError(error: unknown, timeoutMs: number): unknown {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new LlmError(`Anthropic request failed: timed out after ${timeoutMs} ms`, {
      retryable: true,
    });
  }
  // fetch reports network failures (DNS, refused or dropped connections) as TypeError.
  if (error instanceof TypeError) {
    return new LlmError(`Anthropic request failed: ${error.message}`, { retryable: true });
  }
  return error;
}

async function httpError(response: Response): Promise<LlmError> {
  const detail = await response.text().catch(() => '');
  return new LlmError(`Anthropic API returned ${response.status}: ${detail}`.trim(), {
    retryable: response.status === 429 || response.status >= 500,
    retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
  });
}

function parseMessage(body: unknown): LlmResponse {
  const message: MessagesResponse = typeof body === 'object' && body !== null ? body : {};
  const usage: LlmUsage = {
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
    cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
  };
  const unusable = (reason: string) => new LlmError(reason, { retryable: false, usage });

  if (message.stop_reason !== 'end_turn') {
    throw unusable(`Anthropic response stopped with "${String(message.stop_reason)}"`);
  }
  const text = Array.isArray(message.content)
    ? (message.content as { type?: unknown; text?: unknown }[]).find(
        (block) => block?.type === 'text',
      )?.text
    : undefined;
  if (typeof text !== 'string') throw unusable('Anthropic response has no text block');

  try {
    return { data: JSON.parse(text), usage };
  } catch {
    throw unusable('Anthropic response is not valid JSON');
  }
}

function retryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
