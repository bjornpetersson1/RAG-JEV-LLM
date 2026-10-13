import { describe, expect, it } from 'vitest';
import type { Embedder, EmbedKind } from '../embedding/types.js';
import { rememberingLastQuery } from './sweep-setup.js';

function countingEmbedder() {
  const calls: { texts: readonly string[]; kind: EmbedKind }[] = [];
  const embedder: Embedder = {
    name: 'fake',
    model: 'fake-model',
    dtype: 'int8',
    async embed(texts, kind) {
      calls.push({ texts, kind });
      return texts.map((text) => ({ dense: new Float32Array([text.length]) }));
    },
  };
  return { embedder, calls };
}

describe('rememberingLastQuery', () => {
  it('embeds a repeated query once', async () => {
    const { embedder, calls } = countingEmbedder();
    const remembering = rememberingLastQuery(embedder);

    const first = await remembering.embed(['A query'], 'query');
    const second = await remembering.embed(['A query'], 'query');

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it('embeds a new query, passages and several texts afresh', async () => {
    const { embedder, calls } = countingEmbedder();
    const remembering = rememberingLastQuery(embedder);

    await remembering.embed(['A query'], 'query');
    await remembering.embed(['Another query'], 'query');
    await remembering.embed(['Another query'], 'passage');
    await remembering.embed(['Another query', 'More'], 'query');

    expect(calls).toHaveLength(4);
  });
});
