import type { FlowState } from './FlowProgress';
import { DEMO_NOTICE, SECTION_LEADS, type Measure } from './explanations';
import { ExplainedRow, Info } from './Info';
import {
  FLOWS,
  type FlowConfiguration,
  type FlowName,
  type QueryResult,
  type QueryStepName,
  type StepTimings,
} from './query';

interface Row {
  label: string;
  /** The step whose event brings the row's time; absent for the total. */
  step?: QueryStepName | ((planned: readonly QueryStepName[]) => QueryStepName);
  timing: keyof StepTimings;
  /** What the row's (i) button explains, with its detail's text if it has one (E7-11). */
  measure: Measure;
  detail?: Measure;
  /** The summary rows stand out: time to sources, the comparison's measure, and the total. */
  className?: string;
}

const ROWS: Row[] = [
  { label: 'Översättning', step: 'translation', timing: 'translationMs', measure: 'translation' },
  { label: 'Sökning', step: 'search', timing: 'searchMs', measure: 'search' },
  { label: 'varav inbäddning', step: 'search', timing: 'embeddingMs', measure: 'embedding' },
  {
    label: 'Rerank',
    step: 'rerank',
    timing: 'judgingMs',
    measure: 'rerank',
    detail: 'rerankDetail',
  },
  {
    label: 'Tid till källor',
    // Known with the rerank, or with the search in a flow without one.
    step: (planned) => (planned.includes('rerank') ? 'rerank' : 'search'),
    timing: 'sourcesMs',
    measure: 'sources',
    className: 'sources',
  },
  {
    label: 'Generering',
    step: 'generation',
    timing: 'generationMs',
    measure: 'generation',
    detail: 'generationDetail',
  },
  { label: 'Totalt', timing: 'totalMs', measure: 'total', className: 'total' },
];

/**
 * What the panel needs of a flow: a live flow's state, or a run read back from the run log, whose
 * result has only the logged timings (an older entry may lack some), judging and token use.
 */
export interface TimingFlow extends Omit<FlowState, 'result'> {
  result?: Pick<QueryResult, 'judging' | 'usage'> & { timings: Partial<StepTimings> };
}

interface TimingPanelProps {
  flows: Partial<Record<FlowName, TimingFlow>>;
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
  state: TimingFlow;
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
      <p className="lead">{SECTION_LEADS.timing}</p>
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
            <ExplainedRow
              key={row.label}
              label={row.label}
              measure={row.measure}
              detail={row.detail}
              columns={columns.length + 1}
              className={row.className}
            >
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
            </ExplainedRow>
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
      {columns.some(({ state }) => state.configuration) && (
        <p className="configuration">
          Om konfigurationen <Info measure="configuration" />
        </p>
      )}
    </section>
  );
}

interface TimingCellProps {
  ms?: number;
  /** Whether the step is still to come. */
  pending: boolean;
  state: TimingFlow;
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
        {row.step === 'generation' && <GenerationDetail state={state} ms={ms} />}
      </span>
      <span className="bar" style={{ width: `${(ms / scale) * 100}%` }} />
    </>
  );
}

/** A step still to come: planned and not reported, or the total, until the flow's result. */
function isPending({ result, planned, steps }: TimingFlow, row: Row): boolean {
  if (result) return false;
  const step = typeof row.step === 'function' ? row.step(planned) : row.step;
  return step === undefined || (planned.includes(step) && !steps[step]);
}

/** The average time per candidate the reranker scored (cache hits left out), and the hits. */
function RerankDetail({ state, ms }: { state: TimingFlow; ms: number }) {
  const { judgeCalls = 0, cacheHits = 0 } = state.result?.judging ?? {};
  const perCall = ms / judgeCalls;
  const details = [
    ...(judgeCalls > 0 ? [`${formatPerUnit(perCall)} per bedömd kandidat`] : []),
    ...(cacheHits > 0 ? [`${cacheHits} cacheträffar`] : []),
  ];
  return details.length > 0 ? <span className="detail"> ({details.join(' · ')})</span> : null;
}

/** The draft's output tokens and the time per token, so drafts of different length compare. */
function GenerationDetail({ state, ms }: { state: TimingFlow; ms: number }) {
  const tokens = state.result?.usage?.generation?.outputTokens;
  if (!tokens) return null;
  const perToken = ms / tokens;
  return (
    <span className="detail">
      {' '}
      ({tokens.toLocaleString('sv-SE')} tokens, {formatPerUnit(perToken)}/token)
    </span>
  );
}

/** The final timings when the flow is done, else the times its finished steps reported. */
function timingsOf({ result, steps }: TimingFlow): Partial<StepTimings> {
  return (
    result?.timings ?? Object.assign({}, ...Object.values(steps).map(({ timings }) => timings))
  );
}

/**
 * Time to sources first, the measure the comparison is about, with the translation named on its
 * own; then what the gap consists of and which flow knew its sources first; then the total, which
 * the drafts' length weighs on too. Always with the notice that the UI's numbers are a demo.
 */
function Difference({ flows }: { flows: Partial<Record<FlowName, TimingFlow>> }) {
  const main = flows.main?.result?.timings;
  const reference = flows.reference?.result?.timings;
  if (main?.sourcesMs === undefined || reference?.sourcesMs === undefined) return null;
  const { translationMs } = main;
  const sources = describeGap(main.sourcesMs, reference.sourcesMs, 'före', 'efter');
  // The verdict is given both without and with the translation, so neither hides the other.
  const withTranslation =
    translationMs === undefined
      ? ''
      : `, och ${describeGap(main.sourcesMs + translationMs, reference.sourcesMs, 'före', 'efter')} med översättningen till taggar (${formatMs(translationMs)})`;
  const mainFirst = main.sourcesMs + (translationMs ?? 0) <= reference.sourcesMs;
  return (
    <div className="comparison">
      <div className="heading-with-info">
        <h3>Jämförelse</h3>
        <Info measure="comparison" />
      </div>
      <p className="difference">
        Huvudflödet hade sina källor {sources} referens-RAG:en
        {translationMs === undefined ? '' : ' utan översättningen'}
        {withTranslation}.
      </p>
      <p className="difference">
        {[describeParts(main, reference), describeFirst(mainFirst, translationMs !== undefined)]
          .filter(Boolean)
          .join(' ')}
      </p>
      {main.totalMs !== undefined && reference.totalMs !== undefined && (
        <p className="difference">
          Totalt var huvudflödet{' '}
          {describeGap(main.totalMs, reference.totalMs, 'snabbare', 'långsammare')} än
          referens-RAG:en.
        </p>
      )}
      <p className="demo">{DEMO_NOTICE}</p>
    </div>
  );
}

/** Which flow knew its sources first, counting the main flow's translation when it has one. */
function describeFirst(mainFirst: boolean, withTranslation: boolean): string {
  const first = mainFirst ? 'huvudflödet' : 'referens-RAG:en';
  const rest = 'först vilka källor utkastet skulle bygga på.';
  if (withTranslation) return `Räknat med översättningen visste ${first} ${rest}`;
  return `${first[0].toUpperCase()}${first.slice(1)} visste ${rest}`;
}

/** The steps the time to sources consists of, each flow's time side by side. */
function describeParts(main: Partial<StepTimings>, reference: Partial<StepTimings>): string {
  const sideBySide = (label: string, timing: 'searchMs' | 'judgingMs') => {
    const mainMs = main[timing];
    const referenceMs = reference[timing];
    return mainMs === undefined || referenceMs === undefined
      ? []
      : [`${label} (${formatMs(mainMs)} mot ${formatMs(referenceMs)})`];
  };
  const parts = [
    ...(main.translationMs === undefined
      ? []
      : [`översättningen till taggar (${formatMs(main.translationMs)}, bara i huvudflödet)`]),
    ...sideBySide('sökningen', 'searchMs'),
    ...sideBySide('domarens bedömning', 'judgingMs'),
  ];
  return parts.length === 0 ? '' : `Skillnaden består av ${joinSwedish(parts)}.`;
}

/** `a`, `a och b`, `a, b och c`. */
function joinSwedish(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}`;
}

/** How far `main` is from `reference`, and which way, e.g. `2,7 s efter`. */
function describeGap(main: number, reference: number, sooner: string, later: string): string {
  return `${formatMs(Math.abs(reference - main))} ${main <= reference ? sooner : later}`;
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

/** A time per candidate or token: `<1 ms` below a millisecond, else as `formatMs`. */
function formatPerUnit(ms: number): string {
  return ms < 1 ? '<1 ms' : formatMs(ms);
}

/** Under a second in ms, otherwise in seconds with one decimal, e.g. `340 ms`, `12,4 s`. */
export function formatMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
