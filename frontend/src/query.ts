// The client side of `POST /api/query` (E7-1): sends the form and reads the streamed steps, one
// JSON line each, as they arrive. The types mirror the backend's `QueryEvent`.

export type Template = 'employment' | 'nda';
export type FlowName = 'main' | 'reference';

/** The contract types, with their names in the UI. */
export const TEMPLATES: readonly { value: Template; label: string }[] = [
  { value: 'employment', label: 'Anställningsavtal' },
  { value: 'nda', label: 'Sekretessavtal' },
];

/** The flows in the order they run, with their titles in the UI. */
export const FLOWS: readonly { flow: FlowName; title: string }[] = [
  { flow: 'main', title: 'Huvudflödet' },
  { flow: 'reference', title: 'Referens-RAG' },
];

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
  document?: { title: string; url?: string };
}

/** Where a candidate came from. */
export type Origin = 'tag' | 'fts' | 'dense' | 'lexical' | 'named';

/** What became of a candidate (see the backend's `SourceStatus`). */
export type SourceStatus = 'cited' | 'sent' | 'left-out' | 'turned-down';

export interface QuerySource {
  chunk: Chunk;
  status: SourceStatus;
  origin: Origin;
  score?: number;
  reranker?: string;
}

/** Where a reference is in the draft: offsets into the text as written, end exclusive. */
interface ReferenceSpan {
  kind: 'citation' | 'free-text';
  text: string;
  start: number;
  end: number;
}

/** A reference in the draft that points to a submitted chunk. */
export interface ReferenceMatch extends ReferenceSpan {
  chunkId: string;
}

/** A reference in the draft that matches no submitted chunk. */
export interface ReferenceFlag extends ReferenceSpan {
  reason: string;
  /** For a citation, the cited id. */
  chunkId?: string;
}

export interface PostCheck {
  flags: ReferenceFlag[];
  matches: ReferenceMatch[];
  references: number;
  valid: number;
  sourceAccuracy: number | null;
}

export interface Draft {
  text?: string;
  /** Sent chunks the draft cites, in order of first citation. */
  used: Chunk[];
  /** Sent chunks the draft does not cite. */
  unused: Chunk[];
  /** Approved chunks the context limits kept out. */
  leftOut: Chunk[];
  check?: PostCheck;
}

/** One finished step, with its part of the result's `timings`. */
export type QueryStep = (
  | { step: 'translation'; tags: QueryTag[] }
  | { step: 'search'; candidates: number; fallback: number }
  | {
      step: 'rerank';
      /** The candidates given to the reranker. */
      candidates: number;
      /** Whether a threshold decided relevance (a judge), or only `RERANK_TOP_K` cut (a ranker). */
      judged: boolean;
      relevant: number;
      /** Candidates that could not be scored (a failed or timed-out call); not relevant. */
      unknown: number;
      approved: number;
    }
  | { step: 'generation' }
) & { timings: Partial<StepTimings> };

export type QueryStepName = QueryStep['step'];

/** Each step's time in ms; a step that did not run is absent. */
export interface StepTimings {
  translationMs?: number;
  /** Part of `searchMs`. */
  embeddingMs?: number;
  searchMs: number;
  judgingMs?: number;
  /** Time to sources: search plus rerank, without the translation (E7-8). */
  sourcesMs: number;
  generationMs?: number;
  totalMs: number;
}

/** What a flow runs with (see the backend's `FlowConfiguration`). */
export interface FlowConfiguration {
  retriever: string;
  reranker?: string;
  translator?: string;
  generator: string;
  tagIndex?: string;
  topK: number;
}

export interface QueryResult {
  flow: FlowName;
  tags: string[];
  candidates: number;
  fallback: number;
  defaultInstruction?: string;
  approved: Chunk[];
  /** Every candidate, in the retriever's order, with what became of it. */
  sources: QuerySource[];
  /** Absent without a rerank step. */
  judging?: { cacheHits: number; judgeCalls: number; relevant: number; unknown: number };
  draft?: Draft;
  timings: StepTimings;
  /** Token use per step; the timing panel reads the draft's output tokens. */
  usage?: { generation?: { outputTokens: number } };
}

export type QueryEvent =
  | { type: 'start'; flow: FlowName; steps: QueryStepName[]; configuration?: FlowConfiguration }
  | ({ type: 'step'; flow: FlowName } & QueryStep)
  | { type: 'result'; flow: FlowName; result: QueryResult }
  | { type: 'error'; flow: FlowName; message: string }
  /** A flow the backend could not build, e.g. the reference RAG before `npm run index:embed`. */
  | { type: 'skipped'; flow: FlowName; reason: string }
  | { type: 'done' };

/** What a flow reports while it runs: its plan, its finished steps and its result. */
export type ProgressEvent = Extract<QueryEvent, { type: 'start' | 'step' | 'result' | 'skipped' }>;

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
