// The client side of `POST /api/query` (E7-1): sends the form and reads the streamed steps, one
// JSON line each, as they arrive. The types mirror the backend's `QueryEvent`.

export type Template = 'employment' | 'nda';
export type FlowName = 'main' | 'reference';

export interface QueryRequest {
  template: Template;
  /** May be empty: the template's preset tags and default instruction are used. */
  instruction: string;
  /** Also run the reference RAG, after the main flow. */
  reference: boolean;
}

export interface QueryTag {
  slug: string;
  origin: 'preset' | 'translated';
}

export interface Chunk {
  id: string;
  text: string;
  source?: string;
}

export type QueryStep =
  | { step: 'translation'; tags: QueryTag[]; elapsedMs: number }
  | { step: 'search'; candidates: number; fallback: number; embeddingMs?: number; searchMs: number }
  | { step: 'rerank'; approved: number; relevant: number; elapsedMs: number }
  | { step: 'generation'; elapsedMs: number };

export type QueryStepName = QueryStep['step'];

export interface QueryResult {
  flow: FlowName;
  tags: string[];
  candidates: number;
  fallback: number;
  defaultInstruction?: string;
  approved: Chunk[];
  draft?: { text?: string; used: Chunk[]; unused: Chunk[] };
}

export type QueryEvent =
  | { type: 'start'; flow: FlowName; steps: QueryStepName[] }
  | ({ type: 'step'; flow: FlowName } & QueryStep)
  | { type: 'result'; flow: FlowName; result: QueryResult }
  | { type: 'error'; flow: FlowName; message: string }
  | { type: 'done' };

/** What a flow reports while it runs: its plan, its finished steps and its result. */
export type ProgressEvent = Extract<QueryEvent, { type: 'start' | 'step' | 'result' }>;

/** A failed query, with a message for the user. */
export class QueryError extends Error {}

const FLOW_NAMES: Record<FlowName, string> = { main: 'huvudflödet', reference: 'referens-RAG:en' };

/**
 * Posts the query and passes each event to `onEvent` as it arrives. Throws a `QueryError` when the
 * backend cannot be reached, answers with an error, reports an error event or breaks off the stream.
 */
export async function streamQuery(
  request: QueryRequest,
  onEvent: (event: ProgressEvent) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    throw new QueryError('Kunde inte nå servern. Kontrollera att backend körs.');
  }
  if (!response.ok) throw new QueryError(await errorMessage(response));
  if (!response.body) throw new QueryError('Servern skickade inget svar.');

  for await (const event of readEvents(response.body)) {
    if (event.type === 'error') {
      throw new QueryError(`Fel i ${FLOW_NAMES[event.flow]}: ${event.message}`);
    }
    if (event.type === 'done') return;
    onEvent(event);
  }
  throw new QueryError('Svaret från servern avbröts innan frågan var klar.');
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 409)
    return 'En fråga körs redan. Vänta tills den är klar och försök igen.';
  const body: unknown = await response.json().catch(() => undefined);
  const detail =
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? `: ${body.error}`
      : '';
  return `Servern svarade med fel ${response.status}${detail}`;
}

/**
 * The stream's JSON lines as events. A read error ends them (the caller reports the broken-off
 * stream); a line that is not JSON is an invalid answer. The reader is released however it ends.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<QueryEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return;
      }
      if (chunk.done) return;
      buffered += decoder.decode(chunk.value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() !== '') yield parseEvent(line);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function parseEvent(line: string): QueryEvent {
  try {
    return JSON.parse(line) as QueryEvent;
  } catch {
    throw new QueryError('Servern skickade ett ogiltigt svar.');
  }
}
