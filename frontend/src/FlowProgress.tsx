import type { FlowName, QueryResult, QueryStep, QueryStepName } from './query';

/** What one flow has reported so far. */
export interface FlowState {
  /** The steps the backend said the flow will run, in order. */
  planned: QueryStepName[];
  steps: Partial<{ [S in QueryStep as S['step']]: S }>;
  result?: QueryResult;
}

const TITLES: Record<FlowName, string> = { main: 'Huvudflödet', reference: 'Referens-RAG' };

const RUNNING: Record<QueryStepName, string> = {
  translation: 'Översätter frågan till taggar…',
  search: 'Söker kandidater…',
  rerank: 'Bedömer kandidaterna…',
  generation: 'Skriver utkast…',
};

interface FlowProgressProps {
  flow: FlowName;
  state: FlowState;
  /** Whether this flow is the one running now. */
  active: boolean;
}

/** One flow's tags, counts and draft, each shown as soon as its step is done. */
export function FlowProgress({ flow, state, active }: FlowProgressProps) {
  const { planned, steps, result } = state;
  const pending = active ? planned.find((step) => !steps[step]) : undefined;
  return (
    <section className="flow" aria-label={TITLES[flow]}>
      <h2>{TITLES[flow]}</h2>
      {result?.defaultInstruction && (
        <p className="notice">
          Ingen fritext angavs, så instruktionen &quot;{result.defaultInstruction}&quot; användes.
        </p>
      )}
      {steps.translation && (
        <div className="tags">
          Taggar:{' '}
          {steps.translation.tags.length === 0
            ? 'inga'
            : steps.translation.tags.map(({ slug, origin }) => (
                <span key={slug} className={`tag tag-${origin}`}>
                  {slug} ({origin === 'preset' ? 'mall' : 'översatt'})
                </span>
              ))}
        </div>
      )}
      {steps.search && <p>{describeSearch(flow, steps.search)}</p>}
      {steps.rerank && <p>{steps.rerank.approved} godkända av rerankern</p>}
      {pending && (
        <p className="pending" role="status">
          {RUNNING[pending]}
        </p>
      )}
      {result && <Draft result={result} />}
    </section>
  );
}

function describeSearch(
  flow: FlowName,
  { candidates, fallback }: Extract<QueryStep, { step: 'search' }>,
): string {
  if (flow === 'reference') return `${candidates} närmaste chunkar skickas till generatorn`;
  return fallback > 0
    ? `${candidates} kandidater, varav ${fallback} från fritextsökning`
    : `${candidates} kandidater`;
}

function Draft({ result }: { result: QueryResult }) {
  if (!result.draft) return <p>Inget utkast skrevs: inga relevanta källor hittades.</p>;
  if (result.draft.text === undefined) {
    return <p>Inget utkast skrevs: inga godkända källor rymdes i kontextgränserna.</p>;
  }
  return <pre className="draft">{result.draft.text}</pre>;
}
