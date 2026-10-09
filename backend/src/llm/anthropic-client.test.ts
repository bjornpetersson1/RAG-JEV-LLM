import { describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, type AnthropicClientOptions } from './anthropic-client.js';
import { LlmError } from './client.js';
import { createCapturingLogger, createFakeFetch, messageResponse } from './test-helpers.js';

const REQUEST = {
  system: 'system prompt',
  prompt: 'user prompt',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

function setup(
  respond: Parameters<typeof createFakeFetch>[0],
  options: Partial<AnthropicClientOptions> = {},
) {
  const { fetch, requests } = createFakeFetch(respond);
  const logger = createCapturingLogger();
  const sleep = vi.fn(async () => {});
  const client = createAnthropicClient({
    role: 'generator',
    model: 'claude-opus-5-5',
    apiKey: 'test-key',
    timeoutMs: 1000,
    maxRetries: 2,
    logger,
    fetch,
    sleep,
    ...options,
  });
  return { client, requests, logger, sleep };
}

function sequence(...responses: (() => Response | Error)[]) {
  let call = 0;
  return () => responses[Math.min(call++, responses.length - 1)]();
}

describe('createAnthropicClient', () => {
  it('sends a structured-output Messages API request for the configured model', async () => {
    const { client, requests } = setup(() => messageResponse({ ok: true }));

    await client.complete({ ...REQUEST, maxTokens: 256 });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    expect(request.body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 256,
      system: 'system prompt',
      messages: [{ role: 'user', content: 'user prompt' }],
      output_config: { format: { type: 'json_schema', schema: REQUEST.schema } },
    });
  });

  it('returns the parsed JSON and token usage', async () => {
    const { client } = setup(() => messageResponse({ answer: 42 }, 1200, 300));

    await expect(client.complete(REQUEST)).resolves.toEqual({
      data: { answer: 42 },
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it('logs role, provider, model, latency, tokens, attempts and cost for each call', async () => {
    const { client, logger } = setup(() => messageResponse({}, 1_000_000, 100_000));

    await client.complete(REQUEST);

    expect(logger.info).toHaveBeenCalledOnce();
    const [entry, message] = logger.info.mock.calls[0];
    expect(message).toBe('LLM call');
    expect(entry).toEqual({
      role: 'generator',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      latencyMs: expect.any(Number),
      attempts: 1,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      costUsd: 6,
    });
  });

  it('omits the cost for a model not in the price table', async () => {
    const { client, logger } = setup(() => messageResponse({}), { model: 'unknown-model' });

    await client.complete(REQUEST);

    expect(logger.info.mock.calls[0][0]).toMatchObject({
      model: 'unknown-model',
      costUsd: undefined,
    });
  });

  it('retries 429, 5xx, 529, network errors and timeouts, then logs one entry', async () => {
    const { client, logger, sleep, requests } = setup(
      sequence(
        () => new Response('rate limited', { status: 429, headers: { 'retry-after': '3' } }),
        () => new Response('overloaded', { status: 529 }),
        () => new TypeError('fetch failed'),
        () => new DOMException('timed out', 'TimeoutError'),
        () => new Response('server error', { status: 500 }),
        () => messageResponse({ ok: true }),
      ),
      { maxRetries: 5 },
    );

    await expect(client.complete(REQUEST)).resolves.toMatchObject({ data: { ok: true } });

    expect(requests).toHaveLength(6);
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls[0]).toEqual([3000]);
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toMatchObject({
      attempts: 6,
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('retries a timeout while reading the response body', async () => {
    const bodyTimeout = {
      ok: true,
      json: async () => {
        throw new DOMException('aborted', 'TimeoutError');
      },
    } as unknown as Response;
    const { client, requests } = setup(
      sequence(
        () => bodyTimeout,
        () => messageResponse({ ok: true }),
      ),
    );

    await expect(client.complete(REQUEST)).resolves.toMatchObject({ data: { ok: true } });
    expect(requests).toHaveLength(2);
  });

  it('gives up after maxRetries and logs the failure once', async () => {
    const { client, logger, requests } = setup(() => new Response('overloaded', { status: 529 }));

    await expect(client.complete(REQUEST)).rejects.toThrow(
      'Anthropic API returned 529: overloaded',
    );

    expect(requests).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      role: 'generator',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      latencyMs: expect.any(Number),
      attempts: 3,
      error: 'Anthropic API returned 529: overloaded',
    });
  });

  it('reports a timeout with the configured limit', async () => {
    const { client } = setup(() => new DOMException('aborted', 'TimeoutError'), { maxRetries: 0 });

    await expect(client.complete(REQUEST)).rejects.toThrow(
      'Anthropic request failed: timed out after 1000 ms',
    );
  });

  it('does not retry other 4xx responses', async () => {
    const { client, requests, sleep } = setup(() => new Response('bad request', { status: 400 }));

    const error = await client.complete(REQUEST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({
      retryable: false,
      message: 'Anthropic API returned 400: bad request',
    });
    expect(requests).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry when the server asks to wait longer than the backoff cap', async () => {
    const { client, requests, sleep } = setup(
      () => new Response('rate limited', { status: 429, headers: { 'retry-after': '3600' } }),
    );

    await expect(client.complete(REQUEST)).rejects.toThrow('Anthropic API returned 429');
    expect(requests).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a malformed response body', async () => {
    const { client, requests } = setup(() => Response.json(null));

    await expect(client.complete(REQUEST)).rejects.toThrow('Anthropic response stopped with');
    expect(requests).toHaveLength(1);
  });

  it('logs the billed tokens of a response that hit max_tokens', async () => {
    const { client, logger } = setup(() =>
      Response.json({
        content: [{ type: 'text', text: '{"text": "cut of' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 1000, output_tokens: 16000 },
      }),
    );

    await expect(client.complete(REQUEST)).rejects.toThrow('stopped with "max_tokens"');
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      attempts: 1,
      inputTokens: 1000,
      outputTokens: 16000,
      costUsd: 0.324,
    });
  });

  it('rejects a response that did not finish normally', async () => {
    const { client, requests } = setup(() =>
      Response.json({ content: [], stop_reason: 'refusal', usage: {} }),
    );

    await expect(client.complete(REQUEST)).rejects.toThrow(
      'Anthropic response stopped with "refusal"',
    );
    expect(requests).toHaveLength(1);
  });

  it('rejects a text block that is not JSON', async () => {
    const { client } = setup(() =>
      Response.json({ content: [{ type: 'text', text: 'not json' }], stop_reason: 'end_turn' }),
    );

    await expect(client.complete(REQUEST)).rejects.toThrow('Anthropic response is not valid JSON');
  });
});
