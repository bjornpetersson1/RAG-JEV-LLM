import { describe, expect, it } from 'vitest';
import { loadRetrievalConfig } from './config.js';

describe('loadRetrievalConfig', () => {
  it.each([{}, { RETRIEVER: 'tags' }])('uses tag search for %o', (env) => {
    expect(loadRetrievalConfig(env)).toEqual({ retriever: 'tags' });
  });

  it('rejects an unknown retriever', () => {
    expect(() => loadRetrievalConfig({ RETRIEVER: 'vector' })).toThrow(
      'Invalid RETRIEVER "vector": expected tags',
    );
  });
});
