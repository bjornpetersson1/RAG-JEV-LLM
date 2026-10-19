import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Env } from '../env.js';
import { registerConfigRoute } from './config-route.js';

describe('GET /config', () => {
  async function get(env: Env) {
    const instance = buildApp({ logger: false });
    registerConfigRoute(instance, env);
    const response = await instance.inject({ method: 'GET', url: '/config' });
    await instance.close();
    return response;
  }

  it('names the small judge of the main flow and the LLM judge of the reference RAG', async () => {
    const response = await get({ RERANKER: 'subq', SUBQ_API_KEY: 'test-key' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      judges: { main: { name: 'subq' }, reference: { name: 'llm' } },
      judgeCache: true,
    });
  });

  it('gives both flows the LLM judge by default, and says when the judge cache is off', async () => {
    expect((await get({})).json().judges).toEqual({
      main: { name: 'llm' },
      reference: { name: 'llm' },
    });
    expect((await get({ RERANKER: 'llm', JUDGE_CACHE: 'off' })).json().judgeCache).toBe(false);
  });
});
