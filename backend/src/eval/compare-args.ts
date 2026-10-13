import { parseArgs } from 'node:util';
import { isOneOf } from '../env.js';
import { RETRIEVERS, type RetrieverName } from '../retrieval/config.js';

/** What `run --reranker` compares. */
export interface RunArgs {
  rerankers: string[];
  /** Absent: the configured `RETRIEVER`. */
  retrievers?: RetrieverName[];
}

/**
 * `run` arguments: none for E5-3's evaluation, `--reranker <a,b>` with an optional
 * `--retriever <tags,bge,both>` for the comparison, or `--sweep` for E7-4's sweep. Throws on a name
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
      retriever: { type: 'string' },
      sweep: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) throw new Error(`Unexpected argument "${positionals[0]}"`);
  if (values.sweep) {
    if (values.reranker !== undefined || values.retriever !== undefined) {
      throw new Error('--sweep runs on its own, with the configured reranker');
    }
    return { sweep: true };
  }
  if (values.reranker === undefined) {
    if (values.retriever !== undefined) throw new Error('--retriever needs --reranker');
    return undefined;
  }
  const rerankers = list(values.reranker, '--reranker', rerankerNames);
  if (values.retriever === undefined) return { rerankers };
  return { rerankers, retrievers: list(values.retriever, '--retriever', RETRIEVERS) };
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
