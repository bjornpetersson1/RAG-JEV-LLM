import { describe, expect, it } from 'vitest';
import type { Chunk } from '../llm/types.js';
import { selectContext } from './context.js';

function chunk(id: string, chars: number): Chunk {
  return { id, text: 'x'.repeat(chars) };
}

const ids = (chunks: readonly Chunk[]) => chunks.map((c) => c.id);

describe('selectContext', () => {
  it('sends every chunk, in order, when both limits hold', () => {
    const chunks = [chunk('a', 10), chunk('b', 20)];

    const selection = selectContext(chunks, { maxChunks: 2, maxContextChars: 30 });

    expect(ids(selection.submitted)).toEqual(['a', 'b']);
    expect(selection.leftOut).toEqual([]);
    expect(selection.limitedBy).toEqual([]);
    expect(selection.needed).toEqual({ maxChunks: 2, maxContextChars: 30 });
  });

  it('sends no more than the chunk limit', () => {
    const chunks = [chunk('a', 1), chunk('b', 1), chunk('c', 1)];

    const selection = selectContext(chunks, { maxChunks: 2, maxContextChars: 100 });

    expect(ids(selection.submitted)).toEqual(['a', 'b']);
    expect(ids(selection.leftOut)).toEqual(['c']);
    expect(selection.limitedBy).toEqual(['maxChunks']);
    expect(selection.needed).toEqual({ maxChunks: 3, maxContextChars: 3 });
  });

  it('skips a chunk too long for the character budget and keeps a shorter one after it', () => {
    const chunks = [chunk('a', 40), chunk('b', 50), chunk('c', 10)];

    const selection = selectContext(chunks, { maxChunks: 10, maxContextChars: 60 });

    expect(ids(selection.submitted)).toEqual(['a', 'c']);
    expect(ids(selection.leftOut)).toEqual(['b']);
    expect(selection.limitedBy).toEqual(['maxContextChars']);
    expect(selection.needed).toEqual({ maxChunks: 3, maxContextChars: 100 });
  });

  it('reports both limits when both kept chunks out', () => {
    const chunks = [chunk('a', 5), chunk('b', 50), chunk('c', 5), chunk('d', 5)];

    const selection = selectContext(chunks, { maxChunks: 2, maxContextChars: 20 });

    expect(ids(selection.submitted)).toEqual(['a', 'c']);
    expect(ids(selection.leftOut)).toEqual(['b', 'd']);
    expect(selection.limitedBy).toEqual(['maxContextChars', 'maxChunks']);
  });
});
