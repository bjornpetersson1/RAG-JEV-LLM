import { vi } from 'vitest';
import type { FlowName, QueryEvent, QueryStep } from './query';

/** A streamed response whose JSON lines the test sends one at a time, and then ends. */
export function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }),
    send(event: QueryEvent | string) {
      const line = typeof event === 'string' ? event : JSON.stringify(event);
      controller.enqueue(encoder.encode(`${line}\n`));
    },
    /** A finished step of `flow` (default the main flow). */
    step(step: QueryStep, flow: FlowName = 'main') {
      this.send({ type: 'step', flow, ...step });
    },
    end() {
      controller.close();
    },
  };
}

export type ControlledStream = ReturnType<typeof controlledStream>;

/** Stubs `fetch`: `/api/health` answers ok, `/api/query` with `query`. */
export function stubFetch(query: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) =>
    url === '/api/health' ? Promise.resolve(Response.json({ status: 'ok' })) : query(),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
