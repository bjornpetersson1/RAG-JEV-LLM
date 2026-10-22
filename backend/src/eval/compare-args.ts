import { parseArgs } from 'node:util';
import { isOneOf } from '../env.js';

/** What `run --reranker` compares. */
export interface RunArgs {
  rerankers: string[];
}

/**
 * `run` arguments: none for E5-3's evaluation, `--reranker <a,b>` for the comparison, or
 * `--sweep` for E7-4's sweep. Throws on a name
 * it does not know.
 */
export function parseRunArgs(
  args: string[],
  rerankerNames: readonly string[],
): RunArgs | { sweep: true } | undefined {
  const { values, positionals } = parseArgs({
    args,
    options: {
      reranker: { type: 'string' },
      sweep: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) throw new Error(`Unexpected argument "${positionals[0]}"`);
  if (values.sweep) {
    if (values.reranker !== undefined) {
      throw new Error('--sweep runs on its own, with the configured reranker');
    }
    return { sweep: true };
  }
  if (values.reranker === undefined) return undefined;
  return { rerankers: list(values.reranker, '--reranker', rerankerNames) };
}

function list<T extends string>(value: string, option: string, allowed: readonly T[]): T[] {
  const names = [...new Set(value.split(',').map((name) => name.trim()))];
  for (const name of names) {
    if (!isOneOf(allowed, name)) {
      throw new Error(`Invalid ${option} "${name}": expected ${allowed.join(', ')}`);
    }
  }
  return names as T[];
}
