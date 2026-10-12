import { parseArgs } from 'node:util';
import { isOneOf } from '../env.js';
import { MODEL_DTYPES, type ModelDtype } from './config.js';

/** `--dtype int8|fp32` (default `int8`) from the command line of a model benchmark. */
export function parseDtypeArg(args = process.argv.slice(2)): ModelDtype {
  const { values } = parseArgs({ args, options: { dtype: { type: 'string', default: 'int8' } } });
  const { dtype } = values;
  if (!isOneOf(MODEL_DTYPES, dtype))
    throw new Error(`--dtype must be ${MODEL_DTYPES.join(' or ')}`);
  return dtype;
}

/** Milliseconds as seconds with `digits` decimals, e.g. `3.2 s`. */
export function formatSeconds(ms: number, digits: number): string {
  return `${(ms / 1000).toFixed(digits)} s`;
}
