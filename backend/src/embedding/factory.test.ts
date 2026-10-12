import { describe, expect, it } from 'vitest';
import { createEmbedder, loadEmbedderConfig } from './factory.js';

describe('loadEmbedderConfig', () => {
  it('defaults to bge', () => {
    expect(loadEmbedderConfig({})).toBe('bge');
  });

  it.each([
    [{ EMBEDDER: 'ada' }, 'Invalid EMBEDDER "ada": expected bge'],
    [{ EMBEDDER_DTYPE: 'fp16' }, 'Invalid EMBEDDER_DTYPE "fp16"'],
  ])('rejects %o', (env, message) => {
    expect(() => loadEmbedderConfig(env)).toThrow(message);
  });
});

describe('createEmbedder', () => {
  it('builds the bge embedder without loading the model', () => {
    expect(createEmbedder({ EMBEDDER: 'bge' })).toMatchObject({
      name: 'bge',
      model: 'Xenova/bge-m3',
    });
  });
});
