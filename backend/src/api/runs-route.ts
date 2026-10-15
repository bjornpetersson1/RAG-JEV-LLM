// `GET /runs` (E7-11): the run log's requests for the UI's earlier runs, newest first. A request is
// the flows that shared a `runId` (the main flow and its reference RAG). It filters by contract type
// and by flow and returns one page at a time. The log is read on every call: it is a local file.

import type { FastifyInstance } from 'fastify';
import { parsePositiveInteger } from '../env.js';
import type { QueryFlowName } from '../generation/query-flow.js';
import { readRunLog, RUN_LOG_PATH, type RunLogEntry } from '../generation/run-log.js';
import { isTemplate, TEMPLATES, type Template } from '../tagging/vocabulary.js';

/** Requests per page: what fits on one screen of the list. */
export const RUNS_PAGE_SIZE = 20;

const FLOW_NAMES: readonly QueryFlowName[] = ['main', 'reference'];

/** One request: its flows' log entries, in the order they ran. */
export interface LoggedRequest {
  runId: string;
  /** When its first flow started (the run log stamps an entry when its run starts). */
  timestamp: string;
  flows: RunLogEntry[];
}

export interface RunsPage {
  requests: LoggedRequest[];
  /** Requests that match the filters, on every page. */
  total: number;
  page: number;
  pageSize: number;
}

interface RunsQuery {
  template?: Template;
  flow?: QueryFlowName;
  page: number;
}

/** Registers `GET /runs`, reading the log at `path`. */
export function registerRunsRoute(app: FastifyInstance, path: string = RUN_LOG_PATH): void {
  app.get('/runs', async (request, reply) => {
    const query = parseQuery(request.query);
    if (typeof query === 'string') return reply.code(400).send({ error: query });
    return runsPage(await readRunLog(path), query);
  });
}

/** The page of `entries`' requests that `query` asks for, newest first. */
function runsPage(entries: readonly RunLogEntry[], { template, flow, page }: RunsQuery): RunsPage {
  const matching = groupByRequest(entries).filter(
    (request) =>
      (template === undefined || request.flows[0].template === template) &&
      (flow === undefined || request.flows.some((entry) => entry.flow === flow)),
  );
  const start = (page - 1) * RUNS_PAGE_SIZE;
  return {
    requests: matching.slice(start, start + RUNS_PAGE_SIZE),
    total: matching.length,
    page,
    pageSize: RUNS_PAGE_SIZE,
  };
}

/** The entries grouped by `runId`, newest request first. */
function groupByRequest(entries: readonly RunLogEntry[]): LoggedRequest[] {
  const requests = new Map<string, LoggedRequest>();
  for (const entry of entries) {
    const request = requests.get(entry.runId);
    if (request) request.flows.push(entry);
    else
      requests.set(entry.runId, { runId: entry.runId, timestamp: entry.timestamp, flows: [entry] });
  }
  return [...requests.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function parseQuery(query: unknown): RunsQuery | string {
  const { template, flow, page = '1' } = (query ?? {}) as Record<string, unknown>;
  if (template !== undefined && (typeof template !== 'string' || !isTemplate(template))) {
    return `"template" must be ${TEMPLATES.join(' or ')}`;
  }
  if (flow !== undefined && !isFlowName(flow)) return `"flow" must be ${FLOW_NAMES.join(' or ')}`;
  const pageNumber = typeof page === 'string' ? parsePositiveInteger(page) : undefined;
  if (pageNumber === undefined) return '"page" must be a positive integer';
  return { template, flow, page: pageNumber };
}

function isFlowName(value: unknown): value is QueryFlowName {
  return FLOW_NAMES.some((name) => name === value);
}
