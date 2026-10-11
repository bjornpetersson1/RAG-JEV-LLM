import { describe, expect, it } from 'vitest';
import { parseQueryArgs, QUERY_USAGE } from './query-args.js';

describe('parseQueryArgs', () => {
  it('reads the instruction and the template', () => {
    expect(parseQueryArgs(['Säljare med provanställning', '--template', 'employment'])).toEqual({
      request: { instruction: 'Säljare med provanställning', template: 'employment' },
      limits: {},
    });
  });

  it('reads the context limits that override .env for one run', () => {
    expect(
      parseQueryArgs([
        'NDA',
        '--template=nda',
        '--max-chunks',
        '30',
        '--max-context-chars',
        '90000',
      ]),
    ).toEqual({
      request: { instruction: 'NDA', template: 'nda' },
      limits: { maxChunks: 30, maxContextChars: 90_000 },
    });
  });

  it.each([
    ['no instruction', ['--template', 'nda']],
    ['an empty instruction', ['  ', '--template', 'nda']],
    ['two instructions', ['a', 'b', '--template', 'nda']],
    ['no template', ['NDA']],
    ['an unknown template', ['NDA', '--template', 'lease']],
    ['an invalid chunk limit', ['NDA', '--template', 'nda', '--max-chunks', '0']],
    ['an invalid character limit', ['NDA', '--template', 'nda', '--max-context-chars', 'many']],
    ['an unknown flag', ['NDA', '--template', 'nda', '--verbose']],
  ])('rejects %s', (_case, args) => {
    expect(parseQueryArgs(args)).toBeUndefined();
  });

  it('names the valid templates in the usage message', () => {
    expect(QUERY_USAGE).toContain('--template <employment|nda>');
  });
});
