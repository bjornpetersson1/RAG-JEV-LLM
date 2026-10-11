import { describe, expect, it } from 'vitest';
import { createCapturingLogger, createFakeFetch } from '../llm/test-helpers.js';
import { createJevClient, JevError } from './client.js';

const CONFIG = {
  apiKey: 'jev-key',
  baseUrl: 'https://jev.example/v1',
  model: 'jev-latest',
  timeoutMs: 1000,
};

describe('createJevClient', () => {
  it('posts the state, model and questions with the bearer key and reads the answers', async () => {
    const { fetch, requests } = createFakeFetch(() =>
      Response.json({
        model: 'jev-1.13.0',
        answers: {
          area: {
            type: 'choice',
            choice: 'lon',
            confidence: 0.8,
            probabilities: { lon: 0.8, semester: 0.2 },
          },
          vite: { type: 'noul', noul: 0.7 },
        },
        usage: { input_tokens: 40, output_tokens: 3 },
      }),
    );
    const logger = createCapturingLogger();
    const client = createJevClient({ ...CONFIG, role: 'queryTranslator', logger, fetch });
    const questions = {
      area: {
        type: 'choice' as const,
        instructions: 'Vilket?',
        criteria: { lon: 'Lön', semester: 'Semester' },
      },
      vite: { type: 'noul' as const, instructions: 'Handlar texten om vite?' },
    };

    const response = await client.ask('Avtal om lön', questions);

    expect(requests).toEqual([
      {
        url: 'https://jev.example/v1/systemone',
        headers: { 'content-type': 'application/json', authorization: 'Bearer jev-key' },
        body: { state: 'Avtal om lön', model: 'jev-latest', questions },
      },
    ]);
    expect(response).toEqual({
      answers: {
        area: {
          type: 'choice',
          choice: 'lon',
          confidence: 0.8,
          probabilities: { lon: 0.8, semester: 0.2 },
        },
        vite: { type: 'noul', noul: 0.7 },
      },
      usage: { inputTokens: 40, outputTokens: 3, cacheWriteTokens: 0, cacheReadTokens: 0 },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'queryTranslator',
        provider: 'jev',
        model: 'jev-latest',
        questions: 2,
        inputTokens: 40,
      }),
      'JEV call',
    );
  });

  it.each([
    [
      'an HTTP error',
      () => new Response('quota exceeded', { status: 429 }),
      'http',
      'JEV answered HTTP 429: quota exceeded',
    ],
    [
      'a timeout',
      () => new DOMException('timed out', 'TimeoutError'),
      'timeout',
      'JEV did not answer within 1000 ms',
    ],
    [
      'a network error',
      () => new TypeError('fetch failed'),
      'network',
      'JEV could not be reached: fetch failed',
    ],
    [
      'a body that is not JSON',
      () => new Response('<html>'),
      'response',
      'JEV answered with a body that is not JSON',
    ],
    [
      'no answers',
      () => Response.json({ usage: {} }),
      'response',
      'malformed response: no "answers" object',
    ],
    [
      'a missing answer',
      () => Response.json({ answers: { other: { type: 'noul', noul: 1 } } }),
      'response',
      'no valid noul answer to "vite"',
    ],
    [
      'a noul outside 0–1',
      () => Response.json({ answers: { vite: { type: 'noul', noul: 87 } } }),
      'response',
      'no valid noul answer to "vite"',
    ],
    [
      'a choice answer to a noul question',
      () =>
        Response.json({
          answers: { vite: { type: 'choice', choice: 'x', probabilities: { x: 1 } } },
        }),
      'response',
      'no valid noul answer to "vite"',
    ],
    [
      'a cancelled call',
      () => new DOMException('cancelled', 'AbortError'),
      'aborted',
      'The JEV call was cancelled',
    ],
    [
      'a noul that is not a number',
      () => Response.json({ answers: { vite: { type: 'noul', noul: 'high' } } }),
      'response',
      'no valid noul answer to "vite"',
    ],
  ])('raises a typed error for %s', async (_case, respond, kind, message) => {
    const { fetch } = createFakeFetch(respond as () => Response | Error);
    const logger = createCapturingLogger();
    const client = createJevClient({ ...CONFIG, role: 'queryTranslator', logger, fetch });

    const error = await client
      .ask('text', { vite: { type: 'noul', instructions: 'Handlar texten om vite?' } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(JevError);
    expect(error).toMatchObject({ kind });
    expect((error as Error).message).toContain(message);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'queryTranslator', error: (error as Error).message }),
      'JEV call failed',
    );
  });
});
