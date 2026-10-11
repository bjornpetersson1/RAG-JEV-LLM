import { describe, expect, it } from 'vitest';
import { createEmbedder, loadEmbedderConfig } from './factory.js';

describe('loadEmbedderConfig', () => {
  it('defaults to bge', () => {
    expect(loadEmbedderConfig({})).toBe('bge');
  });

  it('rejects an unknown embedder', () => {
    expect(() => loadEmbedderConfig({ EMBEDDER: 'ada' })).toThrow(
      'Invalid EMBEDDER "ada": expected bge',
    );
  });
});

describe('createEmbedder', () => {
  it('builds the bge placeholder, which throws when used', async () => {
    const embedder = createEmbedder({ EMBEDDER: 'bge' });

    expect(embedder).toMatchObject({ name: 'bge', model: 'BAAI/bge-m3' });
    await expect(embedder.embed(['7 § LAS'], 'query')).rejects.toThrow(
      'EMBEDDER=bge is not implemented yet',
    );
  });
});
