// `GET /runs` (E7-11): the run log's requests for the UI's earlier runs, newest first. A request is
// the flows that shared a `runId` (the main flow and its reference RAG). It filters by contract type,
// by flow and by source (E7-12) and returns one page at a time. The log is read on every call: it is
// a local file.

import type { FastifyInstance } from 'fastify';
import { parsePositiveInteger } from '../env.js';
import type { QueryFlowName } from '../generation/query-flow.js';
import {
  isRunSource,
  readRunLog,
  RUN_LOG_PATH,
  RUN_SOURCES,
  type RunLogEntry,
  type RunSource,
} from '../generation/run-log.js';
import { isTemplate, TEMPLATES, type Template } from '../tagging/vocabulary.js';

/** Requests per page: what fits on one screen of the list. */
export const RUNS_PAGE_SIZE = 20;

const FLOW_NAMES: readonly QueryFlowName[] = ['main', 'reference'];

/**
 * One request: its flows' log entries, the main flow first, since `bench:compare` alternates which
 * flow runs first.
 */
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
  source?: RunSource;
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
function runsPage(
  entries: readonly RunLogEntry[],
  { template, flow, source, page }: RunsQuery,
): RunsPage {
  const matching = groupByRequest(entries).filter(
    (request) =>
      (template === undefined || request.flows[0].template === template) &&
      (flow === undefined || request.flows.some((entry) => entry.flow === flow)) &&
      (source === undefined || request.flows.some((entry) => entry.source === source)),
  );
  const start = (page - 1) * RUNS_PAGE_SIZE;
  return {
    requests: matching.slice(start, start + RUNS_PAGE_SIZE),
    total: matching.length,
    page,
    pageSize: RUNS_PAGE_SIZE,
  };
}

/** The entries grouped by `runId`, newest request first, each with its flows in `FLOW_NAMES` order. */
function groupByRequest(entries: readonly RunLogEntry[]): LoggedRequest[] {
  const requests = new Map<string, LoggedRequest>();
  for (const entry of entries) {
    const request = requests.get(entry.runId);
    if (request) request.flows.push(entry);
    else
      requests.set(entry.runId, { runId: entry.runId, timestamp: entry.timestamp, flows: [entry] });
  }
  for (const { flows } of requests.values()) {
    flows.sort((a, b) => FLOW_NAMES.indexOf(a.flow) - FLOW_NAMES.indexOf(b.flow));
  }
  return [...requests.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function parseQuery(query: unknown): RunsQuery | string {
  const { template, flow, source, page = '1' } = (query ?? {}) as Record<string, unknown>;
  if (template !== undefined && (typeof template !== 'string' || !isTemplate(template))) {
    return `"template" must be ${TEMPLATES.join(' or ')}`;
  }
  if (flow !== undefined && !isFlowName(flow)) return `"flow" must be ${FLOW_NAMES.join(' or ')}`;
  if (source !== undefined && (typeof source !== 'string' || !isRunSource(source))) {
    return `"source" must be ${RUN_SOURCES.join(' or ')}`;
  }
  const pageNumber = typeof page === 'string' ? parsePositiveInteger(page) : undefined;
  if (pageNumber === undefined) return '"page" must be a positive integer';
  return { template, flow, source, page: pageNumber };
}

function isFlowName(value: unknown): value is QueryFlowName {
  return FLOW_NAMES.some((name) => name === value);
}
