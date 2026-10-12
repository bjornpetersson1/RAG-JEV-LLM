// `POST /query` (E7-1): runs the query flow, and the reference RAG after it when asked, and streams
// one JSON line per finished step, so the UI shows the tags, candidates and approved chunks before
// the draft. One query runs at a time: the flow is CPU-bound, and two would distort each other. A
// client that goes away stops the query before its next step, which frees the server again.

import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import { describeError } from '../errors.js';
import {
  plannedSteps,
  runQuery,
  type QueryFlowDependencies,
  type QueryFlowName,
  type QueryResult,
  type QueryStep,
  type QueryStepName,
} from '../generation/query-flow.js';
import { isTemplate, TEMPLATES, type Template } from '../tagging/vocabulary.js';

/**
 * Each flow's steps, built when first asked for: the reference RAG needs `npm run index:embed`,
 * and building it throws when that has not been run.
 */
export type QueryFlows = Record<QueryFlowName, () => QueryFlowDependencies>;

/** One line of the response stream. */
export type QueryEvent =
  | { type: 'start'; flow: QueryFlowName; steps: QueryStepName[] }
  | ({ type: 'step'; flow: QueryFlowName } & QueryStep)
  | { type: 'result'; flow: QueryFlowName; result: QueryResult }
  | { type: 'error'; flow: QueryFlowName; message: string }
  | { type: 'done' };

interface QueryBody {
  template: Template;
  instruction: string;
  reference: boolean;
}

export function registerQueryRoute(app: FastifyInstance, flows: QueryFlows): void {
  let running = false;

  app.post('/query', async (request, reply) => {
    const body = parseBody(request.body);
    if (typeof body === 'string') return reply.code(400).send({ error: body });
    if (running) return reply.code(409).send({ error: 'A query is already running' });

    running = true;
    const stream = new PassThrough();
    const write = (event: QueryEvent) => stream.write(`${JSON.stringify(event)}\n`);
    const abort = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    void runFlows(body, flows, write, abort.signal).finally(() => {
      running = false;
      stream.end();
    });
    return reply.type('application/x-ndjson').send(stream);
  });
}

/**
 * The main flow, then the reference RAG if asked, each announced with the steps it will run; a
 * flow that fails ends the stream with an error.
 */
async function runFlows(
  { template, instruction, reference }: QueryBody,
  flows: QueryFlows,
  write: (event: QueryEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const names: QueryFlowName[] = reference ? ['main', 'reference'] : ['main'];
  for (const flow of names) {
    try {
      const deps = flows[flow]();
      write({ type: 'start', flow, steps: plannedSteps(deps) });
      const result = await runQuery({ template, instruction }, deps, {
        onStep: (step) => write({ type: 'step', flow, ...step }),
        signal,
      });
      write({ type: 'result', flow, result });
    } catch (error) {
      if (!signal.aborted) write({ type: 'error', flow, message: describeError(error) });
      return;
    }
  }
  write({ type: 'done' });
}

/** The request, or why it is invalid. */
function parseBody(body: unknown): QueryBody | string {
  if (typeof body !== 'object' || body === null) return 'The body must be a JSON object';
  const { template, instruction = '', reference = false } = body as Record<string, unknown>;
  if (typeof template !== 'string' || !isTemplate(template)) {
    return `"template" must be ${TEMPLATES.join(' or ')}`;
  }
  if (typeof instruction !== 'string') return '"instruction" must be a string';
  if (typeof reference !== 'boolean') return '"reference" must be true or false';
  return { template, instruction, reference };
}
