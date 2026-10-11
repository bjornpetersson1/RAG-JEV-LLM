import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { EMPTY_TAG_INDEX } from './search/tag-index.js';

describe('GET /health', () => {
  const app = buildApp({ logger: false });

  afterAll(async () => {
    await app.close();
  });

  it('responds 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('tagIndex', () => {
  it('is empty until the server builds it at startup', async () => {
    const app = buildApp({ logger: false });
    expect(app.tagIndex).toBe(EMPTY_TAG_INDEX);
    await app.close();
  });
});
