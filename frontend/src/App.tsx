import { useEffect, useState } from 'react';
import { FlowProgress, type FlowState } from './FlowProgress';
import { QueryForm } from './QueryForm';
import { TimingPanel } from './TimingPanel';
import { fetchHealthStatus } from './health';
import {
  QueryError,
  streamQuery,
  type FlowName,
  type ProgressEvent,
  type QueryRequest,
} from './query';

const UNREACHABLE = 'unreachable';

/** The flows in the order they run; a flow appears once the backend starts it. */
const FLOW_ORDER: FlowName[] = ['main', 'reference'];

interface Run {
  flows: Partial<Record<FlowName, FlowState>>;
  /** Why a flow the backend could not build was skipped. */
  skipped: Partial<Record<FlowName, string>>;
  /** Whether the reference RAG was asked for; it starts after the main flow. */
  reference: boolean;
  running: boolean;
  error?: string;
}

export function App() {
  const [status, setStatus] = useState<string>();
  const [run, setRun] = useState<Run>();

  useEffect(() => {
    let cancelled = false;
    fetchHealthStatus()
      .catch(() => UNREACHABLE)
      .then((result) => {
        if (!cancelled) setStatus(result);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(request: QueryRequest) {
    setRun({ flows: {}, skipped: {}, reference: request.reference, running: true });
    try {
      await streamQuery(request, (event) =>
        setRun(
          (current) =>
            current &&
            (event.type === 'skipped'
              ? { ...current, skipped: { ...current.skipped, [event.flow]: event.reason } }
              : { ...current, flows: apply(current.flows, event) }),
        ),
      );
      setRun((current) => current && { ...current, running: false });
    } catch (error) {
      const message = error instanceof QueryError ? error.message : 'Något gick fel.';
      setRun((current) => current && { ...current, running: false, error: message });
    }
  }

  return (
    <main>
      <h1>Legal RAG POC</h1>
      <p className="health">Backend: {status ?? 'checking…'}</p>
      <QueryForm running={run?.running ?? false} onSubmit={submit} />
      {run?.error && (
        <p className="error" role="alert">
          {run.error}
        </p>
      )}
      {run && (
        <TimingPanel
          flows={run.flows}
          reference={run.reference}
          skipped={run.skipped.reference}
          running={run.running}
        />
      )}
      {run && preparingReference(run) && (
        <p className="pending" role="status">
          Förbereder referens-RAG…
        </p>
      )}
      {FLOW_ORDER.map((flow) => {
        const state = run?.flows[flow];
        return (
          state && (
            <FlowProgress
              key={flow}
              flow={flow}
              state={state}
              active={(run?.running ?? false) && !state.result}
            />
          )
        );
      })}
    </main>
  );
}

/**
 * Between the main flow's result and the reference RAG's start, the server may still be loading the
 * embedder and vectors for it.
 */
function preparingReference({ flows, skipped, reference, running }: Run): boolean {
  return (
    running &&
    reference &&
    flows.main?.result !== undefined &&
    !flows.reference &&
    !skipped.reference
  );
}

function apply(
  flows: Partial<Record<FlowName, FlowState>>,
  event: Exclude<ProgressEvent, { type: 'skipped' }>,
): Partial<Record<FlowName, FlowState>> {
  if (event.type === 'start') {
    const { steps: planned, configuration } = event;
    return { ...flows, [event.flow]: { planned, configuration, steps: {} } };
  }
  const state = flows[event.flow];
  if (!state) return flows;
  if (event.type === 'result')
    return { ...flows, [event.flow]: { ...state, result: event.result } };
  return { ...flows, [event.flow]: { ...state, steps: { ...state.steps, [event.step]: event } } };
}
