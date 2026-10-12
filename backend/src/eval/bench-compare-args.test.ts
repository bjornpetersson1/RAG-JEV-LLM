import { describe, expect, it } from 'vitest';
import { parseBenchArgs } from './bench-compare-args.js';

describe('parseBenchArgs', () => {
  it('runs every query five times with drafts by default', () => {
    expect(parseBenchArgs([])).toEqual({ runs: 5, draft: true });
  });

  it('reads --runs, --limit and --no-draft', () => {
    expect(parseBenchArgs(['--runs', '1', '--limit=5', '--no-draft'])).toEqual({
      runs: 1,
      limit: 5,
      draft: false,
    });
  });

  it.each([
    ['a run count of 0', ['--runs', '0'], 'Invalid --runs "0"'],
    ['a limit that is not a number', ['--limit', 'all'], 'Invalid --limit "all"'],
    ['a positional argument', ['five'], 'Unexpected argument "five"'],
    ['an unknown flag', ['--verbose'], "Unknown option '--verbose'"],
  ])('rejects %s', (_case, args, message) => {
    expect(() => parseBenchArgs(args)).toThrow(message);
  });
});
