import { unitLength } from '../embedding/bge-embedder.js';
import type { Embedder } from '../embedding/types.js';

/** The identity of the fake embedder's vectors, as `index:embed` stores them. */
export const FAKE_IDENTITY = { model: 'fake-embedder', dtype: 'int8' };

/**
 * A deterministic embedder: each text's vector comes from `vectorFor` (by default from its letter
 * counts), scaled to unit length. It counts the texts it embeds.
 */
export function createFakeEmbedder(vectorFor: (text: string) => number[] = letterCounts) {
  const embedded: string[] = [];
  const embedder: Embedder = {
    name: 'fake',
    model: 'fake-embedder',
    dtype: 'int8' as const,
    async embed(texts) {
      embedded.push(...texts);
      return texts.map((text) => ({ dense: unitLength(Float32Array.from(vectorFor(text))) }));
    },
  };
  return { embedder, embedded };
}

/** Counts of a, e, i, o, u and digits, plus one, so no vector is zero. */
function letterCounts(text: string): number[] {
  return ['a', 'e', 'i', 'o', 'u', '0123456789'].map(
    (letters) => [...text.toLowerCase()].filter((c) => letters.includes(c)).length + 1,
  );
}
