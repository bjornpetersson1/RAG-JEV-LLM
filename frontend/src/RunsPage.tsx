import { useEffect, useState } from 'react';
import { SECTION_LEADS, type Measure } from './explanations';
import { Info } from './Info';
import { FLOWS, TEMPLATES, type FlowName, type QueryStepName } from './query';
import {
  fetchRuns,
  type LoggedRequest,
  type RunLogEntry,
  type RunsFilter,
  type RunsPage as Page,
} from './runs';
import { formatMs, TimingPanel, type TimingFlow } from './TimingPanel';

const TEMPLATE_NAMES = Object.fromEntries(TEMPLATES.map(({ value, label }) => [value, label]));
const FLOW_TITLES = Object.fromEntries(FLOWS.map(({ flow, title }) => [flow, title]));

/** The counts a logged flow has, each with its (i) text. */
const COUNTS: { label: string; key: keyof NonNullable<RunLogEntry['counts']>; measure: Measure }[] =
  [
    { label: 'Taggar', key: 'tags', measure: 'tags' },
    { label: 'Kandidater', key: 'candidates', measure: 'candidates' },
    { label: 'varav från fritextsökning', key: 'fallback', measure: 'fallback' },
    { label: 'Godkända', key: 'approved', measure: 'approved' },
    { label: 'Skickade till generatorn', key: 'sent', measure: 'sentCount' },
    { label: 'Citerade', key: 'cited', measure: 'cited' },
  ];

/** Earlier runs from the run log, with filters and pages; opening one shows its timings (E7-11). */
export function RunsPage() {
  const [filter, setFilter] = useState<RunsFilter>({ page: 1 });
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<LoggedRequest>();

  useEffect(() => {
    let cancelled = false;
    fetchRuns(filter).then(
      (result) => {
        if (!cancelled) setPage(result);
      },
      (failure: Error) => {
        if (!cancelled) setError(failure.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filter]);

  /** A new filter or page, without the old page showing under it while the next one loads. */
  function changeFilter(next: RunsFilter) {
    setPage(undefined);
    setError(undefined);
    setFilter(next);
  }

  if (selected) return <RunDetail request={selected} onBack={() => setSelected(undefined)} />;

  const pages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  return (
    <section className="runs" aria-label="Tidigare körningar">
      <h2>Tidigare körningar</h2>
      <p className="lead">{SECTION_LEADS.runs}</p>
      <div className="filters">
        <FilterSelect
          label="Avtalstyp"
          options={TEMPLATES}
          value={filter.template}
          onChange={(template) => changeFilter({ ...filter, template, page: 1 })}
        />
        <FilterSelect
          label="Flöde"
          options={FLOWS.map(({ flow, title }) => ({ value: flow, label: title }))}
          value={filter.flow}
          onChange={(flow) => changeFilter({ ...filter, flow, page: 1 })}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!page && !error && (
        <p className="pending" role="status">
          Hämtar körningar…
        </p>
      )}
      {page && page.requests.length === 0 && <p>Inga körningar.</p>}
      {page && page.requests.length > 0 && (
        <ul className="run-list">
          {page.requests.map((request) => (
            <li key={request.runId}>
              <button type="button" className="run" onClick={() => setSelected(request)}>
                <RequestSummary request={request} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {page && (
        <p className="paging">
          <button
            type="button"
            disabled={filter.page <= 1}
            onClick={() => changeFilter({ ...filter, page: filter.page - 1 })}
          >
            Föregående
          </button>{' '}
          Sida {filter.page} av {pages} ({page.total} körningar){' '}
          <button
            type="button"
            disabled={filter.page >= pages}
            onClick={() => changeFilter({ ...filter, page: filter.page + 1 })}
          >
            Nästa
          </button>
        </p>
      )}
    </section>
  );
}

interface FilterSelectProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  /** Absent for "Alla". */
  value?: T;
  onChange(value: T | undefined): void;
}

function FilterSelect<T extends string>({ label, options, value, onChange }: FilterSelectProps<T>) {
  return (
    <label>
      {label}{' '}
      <select
        value={value ?? ''}
        onChange={(event) =>
          onChange(options.find((option) => option.value === event.target.value)?.value)
        }
      >
        <option value="">Alla</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A request's time, contract type and instruction, and each flow's time to sources and total. */
function RequestSummary({ request }: { request: LoggedRequest }) {
  const [first] = request.flows;
  return (
    <>
      <span className="run-heading">
        {formatTimestamp(request.timestamp)} · {TEMPLATE_NAMES[first.template]} ·{' '}
        {instructionOf(request)}
      </span>
      {request.flows.map((entry) => (
        <span key={entry.flow} className="run-flow">
          {FLOW_TITLES[entry.flow]}:{' '}
          {entry.error
            ? `fel: ${entry.error}`
            : `källor ${formatOptional(entry.timings.sourcesMs)}, totalt ${formatOptional(entry.timings.totalMs)}`}
        </span>
      ))}
    </>
  );
}

function RunDetail({ request, onBack }: { request: LoggedRequest; onBack(): void }) {
  const [first] = request.flows;
  const flows: Partial<Record<FlowName, TimingFlow>> = Object.fromEntries(
    request.flows.map((entry) => [entry.flow, timingFlowOf(entry)]),
  );
  return (
    <section className="run-detail" aria-label="Körning">
      <p>
        <button type="button" onClick={onBack}>
          Tillbaka till listan
        </button>
      </p>
      <h2>
        {TEMPLATE_NAMES[first.template]}, {formatTimestamp(request.timestamp)}
      </h2>
      <p>Instruktion: {instructionOf(request)}</p>
      <TimingPanel flows={flows} reference={flows.reference !== undefined} running={false} />
      {request.flows.map((entry) => (
        <section key={entry.flow} className="flow" aria-label={FLOW_TITLES[entry.flow]}>
          <h3>{FLOW_TITLES[entry.flow]}</h3>
          {entry.error && <p className="error">Körningen misslyckades: {entry.error}</p>}
          <table className="counts">
            <tbody>
              {COUNTS.map(({ label, key, measure }) => (
                <tr key={key}>
                  <th scope="row">
                    {label} <Info measure={measure} />
                  </th>
                  <td>{entry.counts?.[key] ?? '–'}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">
                  Källträffsäkerhet <Info measure="sourceAccuracy" />
                </th>
                <td>{formatAccuracy(entry.sourceAccuracy)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}
    </section>
  );
}

/**
 * A logged flow as the timing panel shows it: done, with the steps its configuration says it runs
 * (or its timings show it ran, for an entry without one), so a failed step stays in the plan.
 */
function timingFlowOf(entry: RunLogEntry): TimingFlow {
  const { timings, configuration } = entry;
  const planned: QueryStepName[] = [
    ...(configuration?.translator || timings.translationMs !== undefined
      ? ['translation' as const]
      : []),
    'search',
    ...(configuration?.reranker || timings.judgingMs !== undefined ? ['rerank' as const] : []),
    'generation',
  ];
  return {
    planned,
    configuration: entry.configuration,
    steps: {},
    result: { timings, judging: entry.judging },
  };
}

/** The instruction as written, or the template's default, which only a finished flow logs. */
function instructionOf({ flows }: LoggedRequest): string {
  return (
    flows[0].instruction ||
    flows.find((entry) => entry.defaultInstruction)?.defaultInstruction ||
    '(mallens instruktion)'
  );
}

function formatOptional(ms: number | undefined): string {
  return ms === undefined ? '–' : formatMs(ms);
}

function formatAccuracy(accuracy: number | null | undefined): string {
  if (accuracy === undefined) return '–';
  // A small margin, since e.g. 0.29 × 100 is 28.999… in floating point.
  return accuracy === null ? 'inga hänvisningar' : `${Math.floor(accuracy * 100 + 1e-9)} %`;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}
