// The client side of `GET /api/runs` (E7-11): earlier runs from the run log. The types mirror the
// backend's `RunLogEntry` and `RunsPage`.

import type { FlowConfiguration, FlowName, QueryResult, StepTimings, Template } from './query';

/** Where a run was started: the UI, `npm run query` or `bench:compare` (E7-12). */
export const RUN_SOURCES = [
  { value: 'api', label: 'UI' },
  { value: 'cli', label: 'Terminal' },
  { value: 'bench', label: 'Benchmark' },
] as const;

export type RunSource = (typeof RUN_SOURCES)[number]['value'];

export interface RunLogEntry {
  timestamp: string;
  runId: string;
  source: RunSource;
  /** Which evaluation query and run (from 1) of `bench:compare`; only on a benchmark entry. */
  bench?: { queryId: string; run: number; runs: number };
  flow: FlowName;
  template: Template;
  instruction: string;
  defaultInstruction?: string;
  configuration?: FlowConfiguration;
  /** An older entry, or a failed run, may lack some. */
  timings: Partial<StepTimings>;
  counts?: {
    tags: number;
    candidates: number;
    fallback: number;
    approved: number;
    sent: number;
    cited: number;
  };
  judging?: QueryResult['judging'];
  sourceAccuracy?: number | null;
  error?: string;
}

export interface LoggedRequest {
  runId: string;
  timestamp: string;
  flows: RunLogEntry[];
}

export interface RunsPage {
  requests: LoggedRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RunsFilter {
  template?: Template;
  flow?: FlowName;
  source?: RunSource;
  page: number;
}

/** One page of earlier runs; throws a message for the user when the backend cannot answer. */
export async function fetchRuns({ template, flow, source, page }: RunsFilter): Promise<RunsPage> {
  const params = new URLSearchParams({
    page: String(page),
    ...(template && { template }),
    ...(flow && { flow }),
    ...(source && { source }),
  });
  let response: Response;
  try {
    response = await fetch(`/api/runs?${params}`);
  } catch {
    throw new Error('Kunde inte nå servern. Kontrollera att backend körs.');
  }
  if (!response.ok) throw new Error(`Servern svarade med fel ${response.status}`);
  return (await response.json()) as RunsPage;
}
