import { describe, expect, it } from 'vitest';
import { loadReferenceTopK } from './config.js';

describe('loadReferenceTopK', () => {
  it('defaults to 8, as RERANK_TOP_K does', () => {
    expect(loadReferenceTopK({})).toBe(8);
  });

  it('reads REFERENCE_TOP_K', () => {
    expect(loadReferenceTopK({ REFERENCE_TOP_K: '12' })).toBe(12);
  });

  it.each(['0', '-1', 'many'])('rejects %s, naming the setting', (value) => {
    expect(() => loadReferenceTopK({ REFERENCE_TOP_K: value })).toThrow('REFERENCE_TOP_K');
  });
});
