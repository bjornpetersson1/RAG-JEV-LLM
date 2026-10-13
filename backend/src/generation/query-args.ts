import { parseArgs } from 'node:util';
import { parsePositiveInteger } from '../env.js';
import { isTemplate, TEMPLATES } from '../tagging/vocabulary.js';
import type { ContextLimits } from './config.js';
import type { QueryRequest } from './query-flow.js';

/** The option that raises each context limit for one run, without its leading `--`. */
export const LIMIT_OPTIONS = {
  maxChunks: 'max-chunks',
  maxContextChars: 'max-context-chars',
} as const satisfies Record<keyof ContextLimits, string>;

type LimitOption = (typeof LIMIT_OPTIONS)[keyof ContextLimits];

export const QUERY_USAGE =
  `Usage: query "<instruction>" --template <${TEMPLATES.join('|')}> ` +
  `[--${LIMIT_OPTIONS.maxChunks} <n>] [--${LIMIT_OPTIONS.maxContextChars} <n>] [--reference]`;

export interface QueryArgs {
  request: QueryRequest;
  /** Limits given on the command line, overriding `.env` for this run. */
  limits: Partial<ContextLimits>;
  /** Run the reference RAG (E5-4) instead of the main flow. */
  reference: boolean;
}

/**
 * `"<instruction>" --template <id> [--max-chunks <n>] [--max-context-chars <n>] [--reference]`, or
 * undefined.
 */
export function parseQueryArgs(args: string[]): QueryArgs | undefined {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        template: { type: 'string' },
        reference: { type: 'boolean', default: false },
        [LIMIT_OPTIONS.maxChunks]: { type: 'string' },
        [LIMIT_OPTIONS.maxContextChars]: { type: 'string' },
      },
      allowPositionals: true,
    });
  } catch {
    return undefined;
  }
  const {
    values: { template, reference, ...limitValues },
    positionals,
  } = parsed;
  const instruction = positionals.length === 1 ? positionals[0].trim() : '';
  if (instruction === '' || !template || !isTemplate(template)) return undefined;

  const limits: Partial<ContextLimits> = {};
  for (const [key, option] of Object.entries(LIMIT_OPTIONS) as [
    keyof ContextLimits,
    LimitOption,
  ][]) {
    const value = limitValues[option];
    if (value === undefined) continue;
    const limit = parsePositiveInteger(value);
    if (limit === undefined) return undefined;
    limits[key] = limit;
  }
  return {
    request: { instruction, template },
    limits,
    reference,
  };
}
