// The run log (E7-3): every run of a query flow, from the UI, `npm run query` or `bench:compare`
// (E7-12), as one JSON line in `logs/runs.jsonl`, with its configuration, timings and counts, or its
// error and the timings it reached. A log that cannot be written is a warning, never a failed query.

import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isOneOf } from '../env.js';
import { describeError } from '../errors.js';
import { REPO_ROOT } from '../repo-root.js';
import { isTemplate } from '../tagging/vocabulary.js';
import type { FlowConfiguration } from './flow-configuration.js';
import {
  flowName,
  runQuery,
  type QueryFlowDependencies,
  type QueryFlowName,
  type QueryOptions,
  type QueryRequest,
  type QueryResult,
  type StepTimings,
} from './query-flow.js';

export const RUN_LOG_PATH = join(REPO_ROOT, 'logs', 'runs.jsonl');

/** Where a run was started: the UI, `npm run query` or `bench:compare`. */
export const RUN_SOURCES = ['api', 'cli', 'bench'] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

export function isRunSource(value: string): value is RunSource {
  return isOneOf(RUN_SOURCES, value);
}

/** Which evaluation query and run of `bench:compare` an entry is. */
export interface BenchRun {
  queryId: string;
  /** From 1. */
  run: number;
  runs: number;
}

export interface RunLogEntry {
  timestamp: string;
  /** Shared by the flows of one request (the main flow and its reference RAG). */
  runId: string;
  source: RunSource;
  /** Only on a `bench:compare` entry. */
  bench?: BenchRun;
  flow: QueryFlowName;
  template: string;
  /** As the user wrote it; empty for a template alone. */
  instruction: string;
  /** The template's default instruction, when it was used instead of empty free text. */
  defaultInstruction?: string;
  configuration?: FlowConfiguration;
  /** A failed run has the timings of the steps it finished. */
  timings: Partial<StepTimings>;
  counts?: {
    tags: number;
    candidates: number;
    fallback: number;
    approved: number;
    sent: number;
    cited: number;
  };
  /** The rerank's counts; absent without a rerank step. */
  judging?: QueryResult['judging'];
  sourceAccuracy?: number | null;
  error?: string;
}

export interface RunLog {
  /** Never throws: a log that cannot be written must not fail the run (`createRunLog` warns). */
  append(entry: RunLogEntry): void;
}

/** Appends to the file at `path`, creating its folder; a failed write is passed to `warn`. */
export function createRunLog(warn: (message: string) => void, path: string = RUN_LOG_PATH): RunLog {
  return {
    append(entry) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, `${JSON.stringify(entry)}\n`);
      } catch (error) {
        warn(`Could not write the run log ${path}: ${describeError(error)}`);
      }
    },
  };
}

/**
 * Every entry in the log at `path`, oldest first (E7-11). A missing log is empty. A line that is not
 * JSON, or lacks what the runs page reads (`runId`, `timestamp`, `flow`, `template`, `timings`), is
 * skipped, so one broken write does not hide the rest. Read asynchronously, so a long log does not
 * hold up a query streaming at the same time.
 */
export async function readRunLog(path: string = RUN_LOG_PATH): Promise<RunLogEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').flatMap((line) => {
    const entry = parseEntry(line);
    return entry ? [entry] : [];
  });
}

function parseEntry(line: string): RunLogEntry | undefined {
  if (line.trim() === '') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { runId, timestamp, flow, template, timings } = value as Record<string, unknown>;
  const complete =
    typeof runId === 'string' &&
    typeof timestamp === 'string' &&
    (flow === 'main' || flow === 'reference') &&
    typeof template === 'string' &&
    isTemplate(template) &&
    typeof timings === 'object' &&
    timings !== null;
  return complete ? (value as RunLogEntry) : undefined;
}

export interface LoggedRun extends QueryOptions {
  log: RunLog;
  source: RunSource;
  runId: string;
  bench?: BenchRun;
}

/** `runQuery`, logging the run when it ends: its result, or its error and the steps it finished. */
export async function runAndLog(
  request: QueryRequest,
  deps: QueryFlowDependencies,
  { log, source, runId, bench, ...options }: LoggedRun,
): Promise<QueryResult> {
  const reached: Partial<StepTimings> = {};
  const entry = {
    timestamp: new Date().toISOString(),
    runId,
    source,
    bench,
    flow: flowName(deps),
    template: request.template,
    instruction: request.instruction,
    configuration: deps.configuration,
  };
  let result: QueryResult;
  try {
    result = await runQuery(request, deps, { ...options, reached });
  } catch (error) {
    log.append({ ...entry, timings: reached, error: describeError(error) });
    throw error;
  }
  // Outside the try, so a finished run is logged once, as finished.
  log.append({
    ...entry,
    ...(result.defaultInstruction !== undefined && {
      defaultInstruction: result.defaultInstruction,
    }),
    timings: result.timings,
    ...outcome(result),
  });
  return result;
}

function outcome({
  tags,
  candidates,
  fallback,
  approved,
  sources,
  judging,
  draft,
}: QueryResult): Pick<RunLogEntry, 'counts' | 'judging' | 'sourceAccuracy'> {
  const count = (statuses: readonly string[]) =>
    sources.filter(({ status }) => statuses.includes(status)).length;
  return {
    counts: {
      tags: tags.length,
      candidates,
      fallback,
      approved: approved.length,
      sent: count(['cited', 'sent']),
      cited: count(['cited']),
    },
    ...(judging && { judging }),
    ...(draft?.check && { sourceAccuracy: draft.check.sourceAccuracy }),
  };
}
