import type { FlowState } from './FlowProgress';
import {
  FLOWS,
  type FlowConfiguration,
  type FlowName,
  type QueryStepName,
  type StepTimings,
} from './query';

type Row = { label: string; step?: QueryStepName; timing: keyof StepTimings };

const ROWS: Row[] = [
  { label: 'Översättning', step: 'translation', timing: 'translationMs' },
  { label: 'Sökning', step: 'search', timing: 'searchMs' },
  { label: 'varav inbäddning', step: 'search', timing: 'embeddingMs' },
  { label: 'Rerank', step: 'rerank', timing: 'judgingMs' },
  { label: 'Generering', step: 'generation', timing: 'generationMs' },
  { label: 'Totalt', timing: 'totalMs' },
];

interface TimingPanelProps {
  flows: Partial<Record<FlowName, FlowState>>;
  /** Whether the reference RAG was asked for. */
  reference: boolean;
  /** Why the reference RAG was skipped, when the backend could not build it. */
  skipped?: string;
  /** Whether the query is still running; after it, a step without a time did not run. */
  running: boolean;
}

/** One flow's column: its state and the times it has so far. */
interface Column {
  flow: FlowName;
  title: string;
  state: FlowState;
  timings: Partial<StepTimings>;
}

/** Time per step and in total for each flow, with bars on one shared scale (E7-3). */
export function TimingPanel({ flows, reference, skipped, running }: TimingPanelProps) {
  const columns: Column[] = FLOWS.flatMap(({ flow, title }) => {
    const state = flows[flow];
    return state ? [{ flow, title, state, timings: timingsOf(state) }] : [];
  });
  if (columns.length === 0) return null;
  const scale = Math.max(
    1,
    ...columns.flatMap(({ timings }) => Object.values(timings).filter((ms) => ms !== undefined)),
  );

  return (
    <section className="timing" aria-label="Tidspanel">
      <h2>Tid per steg</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Steg</th>
            {columns.map(({ flow, title }) => (
              <th key={flow} scope="col">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className={row.timing === 'totalMs' ? 'total' : undefined}>
              <th scope="row">{row.label}</th>
              {columns.map(({ flow, state, timings }) => (
                <td key={flow}>
                  <TimingCell
                    ms={timings[row.timing]}
                    pending={running && isPending(state, row)}
                    state={state}
                    row={row}
                    scale={scale}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Difference flows={flows} />
      {!reference && <p>Referens-RAG:en kördes inte.</p>}
      {skipped && <p>Referens-RAG:en kördes inte: {skipped}</p>}
      {columns.map(
        ({ flow, title, state }) =>
          state.configuration && (
            <p key={flow} className="configuration">
              {title}: {describeConfiguration(state.configuration)}
            </p>
          ),
      )}
    </section>
  );
}

interface TimingCellProps {
  ms?: number;
  /** Whether the step is still to come. */
  pending: boolean;
  state: FlowState;
  row: Row;
  scale: number;
}

/** The time with its bar; `…` for a step still running, `–` for one the flow did not run. */
function TimingCell({ ms, pending, state, row, scale }: TimingCellProps) {
  if (ms === undefined) return <span className="time">{pending ? '…' : '–'}</span>;
  return (
    <>
      <span className="time">
        {formatMs(ms)}
        {row.step === 'rerank' && <RerankDetail state={state} ms={ms} />}
      </span>
      <span className="bar" style={{ width: `${(ms / scale) * 100}%` }} />
    </>
  );
}

/** A step still to come: planned and not reported, or the total, until the flow's result. */
function isPending({ result, planned, steps }: FlowState, { step }: Row): boolean {
  if (result) return false;
  return step === undefined || (planned.includes(step) && !steps[step]);
}

/** The average time per candidate the reranker scored (cache hits left out), and the hits. */
function RerankDetail({ state, ms }: { state: FlowState; ms: number }) {
  const { judgeCalls = 0, cacheHits = 0 } = state.result?.judging ?? {};
  const perCall = ms / judgeCalls;
  const details = [
    ...(judgeCalls > 0 ? [`${perCall < 1 ? '<1 ms' : formatMs(perCall)} per bedömd kandidat`] : []),
    ...(cacheHits > 0 ? [`${cacheHits} cacheträffar`] : []),
  ];
  return details.length > 0 ? <span className="detail"> ({details.join(' · ')})</span> : null;
}

/** The final timings when the flow is done, else the times its finished steps reported. */
function timingsOf({ result, steps }: FlowState): Partial<StepTimings> {
  return (
    result?.timings ?? Object.assign({}, ...Object.values(steps).map(({ timings }) => timings))
  );
}

function Difference({ flows }: { flows: Partial<Record<FlowName, FlowState>> }) {
  const main = flows.main?.result?.timings.totalMs;
  const reference = flows.reference?.result?.timings.totalMs;
  if (main === undefined || reference === undefined) return null;
  const comparison = main <= reference ? 'snabbare' : 'långsammare';
  return (
    <p className="difference">
      Huvudflödet var {formatMs(Math.abs(reference - main))} {comparison} än referens-RAG:en.
    </p>
  );
}

function describeConfiguration(configuration: FlowConfiguration): string {
  const { retriever, tagIndex, translator, reranker, topK, generator } = configuration;
  return [
    `hämtning ${retriever}`,
    ...(tagIndex ? [`taggindex ${tagIndex}`] : []),
    ...(translator ? [`översättare ${translator}`] : []),
    ...(reranker ? [`reranker ${reranker}`] : []),
    `högst ${topK} källor`,
    `generator ${generator}`,
  ].join(' · ');
}

/** Under a second in ms, otherwise in seconds with one decimal, e.g. `340 ms`, `12,4 s`. */
export function formatMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
