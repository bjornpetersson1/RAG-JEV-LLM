import { vi } from 'vitest';
import type { Chunk, FlowName, QueryEvent, QueryResult, QueryStep } from './query';

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

/** A chunk from a document with this source reference; its text names the reference. */
export function chunk(id: string, source: string, url?: string): Chunk {
  return {
    id,
    text: `Text för ${source}.`,
    source,
    document: { title: `Dokument ${id}`, ...(url && { url }) },
  };
}

/** A main-flow result with one cited chunk, overridden as a test needs. */
export function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  const cited = chunk('11', 'SFS 1982:80 7 §');
  return {
    flow: 'main',
    tags: ['anstallningsavtal'],
    candidates: 30,
    fallback: 6,
    approved: [cited],
    sources: [{ chunk: cited, status: 'cited', origin: 'tag', score: 0.9, reranker: 'bge' }],
    draft: { text: '# Anställningsavtal\n\nText [K:11].', used: [cited], unused: [], leftOut: [] },
    timings: {
      translationMs: 800,
      searchMs: 20,
      judgingMs: 3000,
      generationMs: 9000,
      totalMs: 12820,
    },
    ...overrides,
  };
}
