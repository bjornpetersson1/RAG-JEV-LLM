import { memo } from 'react';
import type { FlowConfiguration, FlowName, QueryResult, QueryStep, QueryStepName } from './query';
import { ResultView } from './ResultView';

/** What one flow has reported so far. */
export interface FlowState {
  /** The steps the backend said the flow will run, in order. */
  planned: QueryStepName[];
  configuration?: FlowConfiguration;
  steps: Partial<{ [S in QueryStep as S['step']]: S }>;
  result?: QueryResult;
}

const RUNNING: Record<QueryStepName, string> = {
  translation: 'Översätter frågan till taggar…',
  search: 'Söker kandidater…',
  rerank: 'Bedömer kandidaterna…',
  generation: 'Skriver utkast…',
};

interface FlowProgressProps {
  flow: FlowName;
  title: string;
  state: FlowState;
  /** Whether this flow is the one running now. */
  active: boolean;
}

/**
 * One flow's tags, counts and draft, each shown as soon as its step is done. Memoised, so a
 * finished flow's result view is not re-rendered for every event of the next flow.
 */
export const FlowProgress = memo(function FlowProgress({
  flow,
  title,
  state,
  active,
}: FlowProgressProps) {
  const { planned, steps, result } = state;
  const pending = active ? planned.find((step) => !steps[step]) : undefined;
  return (
    <section className="flow" aria-label={title}>
      <h2>{title}</h2>
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
      {steps.search && <p>{describeSearch(planned, steps.search)}</p>}
      {steps.rerank && <p>{steps.rerank.approved} godkända av rerankern</p>}
      {pending && (
        <p className="pending" role="status">
          {RUNNING[pending]}
        </p>
      )}
      {result && <ResultView flow={flow} result={result} />}
    </section>
  );
});

function describeSearch(
  planned: readonly QueryStepName[],
  { candidates, fallback }: Extract<QueryStep, { step: 'search' }>,
): string {
  // Without a rerank step every candidate goes to the generator (the reference RAG).
  if (!planned.includes('rerank')) return `${candidates} närmaste chunkar skickas till generatorn`;
  return fallback > 0
    ? `${candidates} kandidater, varav ${fallback} från fritextsökning`
    : `${candidates} kandidater`;
}
