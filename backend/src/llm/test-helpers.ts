import { vi } from 'vitest';
import type { LlmLogger } from './client.js';

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch fake that answers each request with `respond(body)` and records what was sent. */
export function createFakeFetch(respond: (body: Record<string, unknown>) => Response | Error) {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    const result = respond(body);
    if (result instanceof Error) throw result;
    return result;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

/** A successful Messages API response whose text block is `data` as JSON. */
export function messageResponse(data: unknown, inputTokens = 100, outputTokens = 20): Response {
  return Response.json({
    content: [{ type: 'text', text: JSON.stringify(data) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}

export function createCapturingLogger() {
  return { info: vi.fn(), error: vi.fn() } satisfies LlmLogger;
}
