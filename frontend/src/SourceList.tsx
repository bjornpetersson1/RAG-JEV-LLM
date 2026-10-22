import type { ReactNode } from 'react';
import { SECTION_LEADS, type Measure } from './explanations';
import { Info } from './Info';
import type { FlowName, Origin, QueryResult, QuerySource, SourceStatus } from './query';

const ORIGINS: Record<Origin, string> = {
  tag: 'tagg',
  fts: 'fritext',
  lexical: 'BM25',
};

const NOT_SENT: Partial<Record<SourceStatus, string>> = {
  'left-out': 'rymdes inte i kontexten',
  'turned-down': 'bortvald av rerankern',
};

interface SourceListProps {
  flow: FlowName;
  result: QueryResult;
  /** The chunk whose reference was clicked last. */
  selected?: string;
  /** The chunks whose text is open. */
  open: ReadonlySet<string>;
  onToggle(id: string, open: boolean): void;
}

/** The funnel: cited sources, sources sent but not cited, and the candidates that were not sent. */
export function SourceList({ flow, result, selected, open, onToggle }: SourceListProps) {
  const { sources, draft } = result;
  // Cited sources in the order the draft first refers to them, the others in the retriever's order.
  const firstReference = new Map<string, number>();
  for (const { chunkId, start } of draft?.check?.matches ?? []) {
    if (!firstReference.has(chunkId)) firstReference.set(chunkId, start);
  }
  const cited = sources
    .filter(({ status }) => status === 'cited')
    .sort(
      (a, b) =>
        (firstReference.get(a.chunk.id) ?? Infinity) - (firstReference.get(b.chunk.id) ?? Infinity),
    );
  const sent = sources.filter(({ status }) => status === 'sent');
  const notSent = sources.filter(({ status }) => status in NOT_SENT);

  const entry = (source: QuerySource) => (
    <SourceEntry
      key={source.chunk.id}
      source={source}
      domId={sourceDomId(flow, source.chunk.id)}
      open={open.has(source.chunk.id)}
      highlighted={selected === source.chunk.id}
      onToggle={(isOpen) => onToggle(source.chunk.id, isOpen)}
    />
  );

  return (
    <div className="sources">
      <p className="lead">
        {SECTION_LEADS.sources} Varje källa visar sin poäng <Info measure="score" /> och sitt
        ursprung <Info measure="origin" />.
      </p>
      <Group title="Citerade källor" measure="cited" sources={cited} entry={entry} />
      <Group title="Skickade men inte citerade" measure="sent" sources={sent} entry={entry} />
      {notSent.length > 0 && (
        <>
          <p className="not-sent-info">
            Om kandidaterna som inte skickades <Info measure="notSent" />
          </p>
          <details className="not-sent">
            <summary>Inte skickade till generatorn ({notSent.length})</summary>
            <ul>{notSent.map(entry)}</ul>
          </details>
        </>
      )}
    </div>
  );
}

/** The element id of a source's entry, unique across both flows' lists. */
export function sourceDomId(flow: FlowName, chunkId: string): string {
  return `source-${flow}-${chunkId}`;
}

interface GroupProps {
  title: string;
  measure: Measure;
  sources: QuerySource[];
  entry(source: QuerySource): ReactNode;
}

function Group({ title, measure, sources, entry }: GroupProps) {
  return (
    <>
      <div className="heading-with-info">
        <h3>
          {title} ({sources.length})
        </h3>
        <Info measure={measure} />
      </div>
      {sources.length === 0 ? <p>Inga.</p> : <ul>{sources.map(entry)}</ul>}
    </>
  );
}

interface SourceEntryProps {
  source: QuerySource;
  domId: string;
  open: boolean;
  highlighted: boolean;
  onToggle(open: boolean): void;
}

function SourceEntry({ source, domId, open, highlighted, onToggle }: SourceEntryProps) {
  const { chunk, status, origin, score, reranker } = source;
  return (
    <li id={domId} className={highlighted ? 'source highlighted' : 'source'}>
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary>
          <strong>{chunk.source ?? `Chunk ${chunk.id}`}</strong>
          {chunk.document && <span className="title"> · {chunk.document.title}</span>}
          {score !== undefined && (
            <span className="score">
              {' '}
              · poäng {score.toFixed(2)} ({reranker})
            </span>
          )}
          <span className="origin"> · {ORIGINS[origin] ?? origin}</span>
          {NOT_SENT[status] && <span className="note"> · {NOT_SENT[status]}</span>}
        </summary>
        <p className="chunk-text">{chunk.text}</p>
        {chunk.document?.url && (
          <a href={chunk.document.url} target="_blank" rel="noreferrer">
            Öppna originalkällan
          </a>
        )}
      </details>
    </li>
  );
}
