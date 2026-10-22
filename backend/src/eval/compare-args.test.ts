import { describe, expect, it } from 'vitest';
import { parseRunArgs } from './compare-args.js';

const RERANKERS = ['jev', 'llm', 'subq'];

describe('parseRunArgs', () => {
  it('means E5-3’s evaluation without --reranker', () => {
    expect(parseRunArgs([], RERANKERS)).toBeUndefined();
  });

  it.each([
    [['--reranker', 'subq,llm'], { rerankers: ['subq', 'llm'] }],
    [['--reranker', 'llm, llm'], { rerankers: ['llm'] }],
  ])('parses %o', (args, expected) => {
    expect(parseRunArgs(args, RERANKERS)).toEqual(expected);
  });

  it.each([
    [['--reranker', 'cohere'], 'Invalid --reranker "cohere": expected jev, llm, subq'],
    [['--reranker', 'llm', '--retriever', 'bge'], "Unknown option '--retriever'"],
    [['extra'], 'Unexpected argument "extra"'],
  ])('rejects %o', (args, message) => {
    expect(() => parseRunArgs(args, RERANKERS)).toThrow(message);
  });

  it('reads --sweep, which runs on its own', () => {
    expect(parseRunArgs(['--sweep'], ['llm'])).toEqual({ sweep: true });
    expect(() => parseRunArgs(['--sweep', '--reranker', 'llm'], ['llm'])).toThrow(
      '--sweep runs on its own',
    );
  });
});
