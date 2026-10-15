// The client side of `GET /api/runs` (E7-11): earlier runs from the run log. The types mirror the
// backend's `RunLogEntry` and `RunsPage`.

import type { FlowConfiguration, FlowName, QueryResult, StepTimings, Template } from './query';

export interface RunLogEntry {
  timestamp: string;
  runId: string;
  source: 'api' | 'cli';
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
  page: number;
}

/** One page of earlier runs; throws a message for the user when the backend cannot answer. */
export async function fetchRuns({ template, flow, page }: RunsFilter): Promise<RunsPage> {
  const params = new URLSearchParams({
    page: String(page),
    ...(template && { template }),
    ...(flow && { flow }),
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
