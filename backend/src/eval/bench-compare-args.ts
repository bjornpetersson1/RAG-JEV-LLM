import { parseArgs } from 'node:util';
import { parsePositiveInteger } from '../env.js';
import { describeError } from '../errors.js';

export interface BenchArgs {
  /** Runs per query and flow (default 5). */
  runs: number;
  /** Only the first this many queries; absent: all. */
  limit?: number;
  draft: boolean;
}

const BENCH_USAGE = 'Usage: bench:compare [--runs <n>] [--limit <n>] [--no-draft] [--yes]';

const DEFAULT_RUNS = 5;

/** `[--runs <n>] [--limit <n>] [--no-draft]`; throws on anything else, with the usage. */
export function parseBenchArgs(args: string[]): BenchArgs {
  try {
    return readBenchArgs(args);
  } catch (error) {
    throw new Error(`${describeError(error)}\n${BENCH_USAGE}`, { cause: error });
  }
}

function readBenchArgs(args: string[]): BenchArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      runs: { type: 'string' },
      limit: { type: 'string' },
      'no-draft': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) throw new Error(`Unexpected argument "${positionals[0]}"`);
  return {
    runs: values.runs === undefined ? DEFAULT_RUNS : positive(values.runs, '--runs'),
    ...(values.limit !== undefined && { limit: positive(values.limit, '--limit') }),
    draft: !values['no-draft'],
  };
}

function positive(value: string, option: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined)
    throw new Error(`Invalid ${option} "${value}": expected a positive integer`);
  return parsed;
}
