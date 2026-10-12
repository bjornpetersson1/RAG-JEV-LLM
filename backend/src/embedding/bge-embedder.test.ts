import { describe, expect, it, vi } from 'vitest';
import type { LocalModelConfig } from '../models/config.js';
import { createBgeEmbedder, unitLength } from './bge-embedder.js';

const CONFIG: LocalModelConfig = { dtype: 'int8', cacheDir: '/models', batchSize: 2 };

/** A model whose vector for a text is [length, 3, 4]; it records every batch it gets. */
function fakeModel() {
  const batches: string[][] = [];
  const load = vi.fn(async () => async (texts: readonly string[]) => {
    batches.push([...texts]);
    return texts.map((text) => Float32Array.from([text.length, 3, 4]));
  });
  return { load, batches };
}

describe('createBgeEmbedder', () => {
  it('returns one unit-length dense vector per text, in order, without sparse weights', async () => {
    const { load } = fakeModel();
    const embedder = createBgeEmbedder(CONFIG, load);

    const embeddings = await embedder.embed(['abc', 'a'], 'passage');

    expect(embeddings).toHaveLength(2);
    for (const { dense, sparse } of embeddings) {
      expect(Math.hypot(...dense)).toBeCloseTo(1, 6);
      expect(sparse).toBeUndefined();
    }
    expect(embeddings[0].dense[0]).toBeGreaterThan(embeddings[1].dense[0]);
  });

  it('batches internally and loads the model once, on first use', async () => {
    const { load, batches } = fakeModel();
    const embedder = createBgeEmbedder(CONFIG, load);
    expect(load).not.toHaveBeenCalled();

    await embedder.embed(['a', 'b', 'c', 'd', 'e'], 'passage');
    await embedder.embed(['f'], 'passage');

    expect(batches).toEqual([['a', 'b'], ['c', 'd'], ['e'], ['f']]);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('Xenova/bge-m3', 'int8', '/models');
  });

  it('spells out law abbreviations in queries but not in passages', async () => {
    const { load, batches } = fakeModel();
    const embedder = createBgeEmbedder(CONFIG, load);

    await embedder.embed(['7 § LAS'], 'query');
    await embedder.embed(['7 § LAS'], 'passage');

    expect(batches).toEqual([['7 § LAS (Lag (1982:80) om anställningsskydd)'], ['7 § LAS']]);
  });

  it('returns nothing for no texts without loading the model', async () => {
    const { load } = fakeModel();

    await expect(createBgeEmbedder(CONFIG, load).embed([], 'query')).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('tries to load again after a failed load', async () => {
    const { load } = fakeModel();
    load.mockRejectedValueOnce(new Error('download failed'));
    const embedder = createBgeEmbedder(CONFIG, load);

    await expect(embedder.embed(['a'], 'passage')).rejects.toThrow('download failed');
    await expect(embedder.embed(['a'], 'passage')).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('unitLength', () => {
  it('scales a vector to length 1', () => {
    expect([...unitLength(Float32Array.from([3, 4]))]).toEqual([
      expect.closeTo(0.6, 6),
      expect.closeTo(0.8, 6),
    ]);
  });

  it('rejects a zero vector', () => {
    expect(() => unitLength(new Float32Array(3))).toThrow('Cannot normalise a zero vector');
  });
});
