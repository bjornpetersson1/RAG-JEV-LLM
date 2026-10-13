// The run log (E7-3): every run of a query flow, from the UI or `npm run query`, as one JSON line in
// `logs/runs.jsonl`, with its configuration, timings and counts, or its error and the timings it
// reached. A log that cannot be written is a warning, never a failed query.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describeError } from '../errors.js';
import { REPO_ROOT } from '../repo-root.js';
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

/** Where a run was started. */
export type RunSource = 'api' | 'cli';

export interface RunLogEntry {
  timestamp: string;
  /** Shared by the flows of one request (the main flow and its reference RAG). */
  runId: string;
  source: RunSource;
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

export interface LoggedRun extends QueryOptions {
  log: RunLog;
  source: RunSource;
  runId: string;
}

/** `runQuery`, logging the run when it ends: its result, or its error and the steps it finished. */
export async function runAndLog(
  request: QueryRequest,
  deps: QueryFlowDependencies,
  { log, source, runId, ...options }: LoggedRun,
): Promise<QueryResult> {
  const reached: Partial<StepTimings> = {};
  const entry = {
    timestamp: new Date().toISOString(),
    runId,
    source,
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
