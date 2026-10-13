import { describe, expect, it } from 'vitest';
import { loadReferenceConfig } from './config.js';

describe('loadReferenceConfig', () => {
  it('defaults to MAX_CANDIDATES’ and RERANK_TOP_K’s defaults, 30 and 8', () => {
    expect(loadReferenceConfig({})).toEqual({ candidates: 30, topK: 8 });
  });

  it('reads MAX_CANDIDATES and RERANK_TOP_K', () => {
    expect(loadReferenceConfig({ MAX_CANDIDATES: '12', RERANK_TOP_K: '4' })).toEqual({
      candidates: 12,
      topK: 4,
    });
  });

  it('validates the LLM judge’s settings also when RERANKER is another reranker', () => {
    expect(() => loadReferenceConfig({ RERANKER: 'minilm', JUDGE_THRESHOLD: '2' })).toThrow(
      'JUDGE_THRESHOLD',
    );
  });

  it('rejects REFERENCE_TOP_K, saying to remove it', () => {
    expect(() => loadReferenceConfig({ REFERENCE_TOP_K: '8' })).toThrow(
      'remove REFERENCE_TOP_K from .env',
    );
  });
});
