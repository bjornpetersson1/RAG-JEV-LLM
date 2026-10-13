import { describe, expect, it } from 'vitest';
import { loadRetrievalConfig } from './config.js';

describe('loadRetrievalConfig', () => {
  it('defaults to tag search, 20 candidates, k 60 and equal weights', () => {
    expect(loadRetrievalConfig({})).toEqual({
      retriever: 'tags',
      candidates: 20,
      rrfK: 60,
      weights: { dense: 1, lexical: 1, tags: 1 },
    });
  });

  it.each(['tags', 'bge', 'both'])('accepts RETRIEVER=%s', (retriever) => {
    expect(loadRetrievalConfig({ RETRIEVER: retriever }).retriever).toBe(retriever);
  });

  it('reads every setting', () => {
    expect(
      loadRetrievalConfig({
        RETRIEVER: 'both',
        RETRIEVE_CANDIDATES: '30',
        RRF_K: '10',
        RRF_WEIGHT_DENSE: '0.7',
        RRF_WEIGHT_LEXICAL: '0.3',
        RRF_WEIGHT_TAGS: '0',
      }),
    ).toEqual({
      retriever: 'both',
      candidates: 30,
      rrfK: 10,
      weights: { dense: 0.7, lexical: 0.3, tags: 0 },
    });
  });

  it.each([
    [{ RETRIEVER: 'vector' }, 'Invalid RETRIEVER "vector": expected tags or bge or both'],
    [{ RETRIEVE_CANDIDATES: '0' }, 'Invalid RETRIEVE_CANDIDATES "0"'],
    [{ RRF_WEIGHT_DENSE: '2' }, 'Invalid RRF_WEIGHT_DENSE "2": expected a number from 0 to 1'],
  ])('rejects %o', (env, message) => {
    expect(() => loadRetrievalConfig(env)).toThrow(message);
  });
});
