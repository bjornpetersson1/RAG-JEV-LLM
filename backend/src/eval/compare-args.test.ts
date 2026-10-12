import { describe, expect, it } from 'vitest';
import { parseRunArgs } from './compare-args.js';

const RERANKERS = ['bge', 'jev', 'llm', 'qwen3'];

describe('parseRunArgs', () => {
  it('means E5-3’s evaluation without --reranker', () => {
    expect(parseRunArgs([], RERANKERS)).toBeUndefined();
  });

  it.each([
    [['--reranker', 'bge,llm'], { rerankers: ['bge', 'llm'] }],
    [
      ['--reranker', 'bge', '--retriever', 'tags,bge,both'],
      { rerankers: ['bge'], retrievers: ['tags', 'bge', 'both'] },
    ],
    [['--reranker', 'llm, llm'], { rerankers: ['llm'] }],
  ])('parses %o', (args, expected) => {
    expect(parseRunArgs(args, RERANKERS)).toEqual(expected);
  });

  it.each([
    [['--reranker', 'cohere'], 'Invalid --reranker "cohere": expected bge, jev, llm, qwen3'],
    [
      ['--reranker', 'bge', '--retriever', 'fts'],
      'Invalid --retriever "fts": expected tags, bge, both',
    ],
    [['--retriever', 'bge'], '--retriever needs --reranker'],
    [['extra'], 'Unexpected argument "extra"'],
  ])('rejects %o', (args, message) => {
    expect(() => parseRunArgs(args, RERANKERS)).toThrow(message);
  });
});
