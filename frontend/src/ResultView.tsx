import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { SECTION_LEADS } from './explanations';
import { Info } from './Info';
import type { Draft, FlowName, PostCheck, QueryResult } from './query';
import { FLAG_LINK, linkReferences } from './references';
import { SourceList, sourceDomId } from './SourceList';

interface ResultViewProps {
  flow: FlowName;
  result: QueryResult;
}

/** The draft with clickable references, the post-check, and the source list. */
export function ResultView({ flow, result }: ResultViewProps) {
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string, isOpen: boolean) =>
    setOpen((current) => {
      if (current.has(id) === isOpen) return current;
      const next = new Set(current);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });

  // Clicking a reference opens its source and scrolls to it, also when it was clicked before.
  const select = useCallback(
    (id: string) => {
      setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
      setSelected(id);
      // After React has opened the source, so it is centred at its open size.
      requestAnimationFrame(() =>
        document
          .getElementById(sourceDomId(flow, id))
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }),
      );
    },
    [flow],
  );

  return (
    <div className="result">
      <DraftView
        flow={flow}
        draft={result.draft}
        unknown={result.judging?.unknown ?? 0}
        onSelect={select}
      />
      <SourceList flow={flow} result={result} selected={selected} open={open} onToggle={toggle} />
    </div>
  );
}

interface DraftViewProps {
  flow: FlowName;
  draft?: Draft;
  /** Candidates the reranker could not score, so "nothing relevant" may not be the whole story. */
  unknown: number;
  onSelect(id: string): void;
}

function DraftView({ flow, draft, unknown, onSelect }: DraftViewProps) {
  const text = draft?.text;
  const check = draft?.check;
  // Parsed once per draft, not on every click in the source list.
  const rendered = useMemo(
    () =>
      text === undefined ? null : (
        <Markdown
          components={{
            a: ({ href, title, children }) => (
              <ReferenceLink
                href={href}
                title={title}
                sourceLink={`#${sourceDomId(flow, '')}`}
                onSelect={onSelect}
              >
                {children}
              </ReferenceLink>
            ),
          }}
        >
          {check ? linkReferences(text, check, (id) => `#${sourceDomId(flow, id)}`) : text}
        </Markdown>
      ),
    [flow, text, check, onSelect],
  );

  if (!draft) {
    return unknown > 0 ? (
      <p>
        Inget utkast skrevs: inga källor bedömdes som relevanta, och {unknown} kunde inte bedömas.
      </p>
    ) : (
      <p>Inget utkast skrevs: inga relevanta källor hittades.</p>
    );
  }
  if (text === undefined) {
    return <p>Inget utkast skrevs: inga godkända källor rymdes i kontextgränserna.</p>;
  }
  return (
    <>
      <p className="disclaimer">
        Utkastet är underlag, inte juridisk rådgivning. Kontrollera källorna innan det används.
      </p>
      <CopyButton text={text} />
      {check && <CheckSummary check={check} />}
      <article className="draft">{rendered}</article>
    </>
  );
}

interface ReferenceLinkProps {
  href?: string;
  title?: string;
  /** The start of a link to a source of this flow, followed by the chunk id. */
  sourceLink: string;
  onSelect(id: string): void;
  children: ReactNode;
}

/** A matched reference selects its source; a flagged one is marked with the reason; others open. */
function ReferenceLink({ href = '', title, sourceLink, onSelect, children }: ReferenceLinkProps) {
  if (href.startsWith(sourceLink)) {
    // The href is the source entry's own id, so a new tab or a copied link still points to it.
    const select = (event: MouseEvent) => {
      event.preventDefault();
      onSelect(href.slice(sourceLink.length));
    };
    return (
      <a href={href} className="reference" onClick={select}>
        {children}
      </a>
    );
  }
  if (href === FLAG_LINK) {
    return (
      <span className="flagged" title={`Flaggad: ${title ?? ''}`}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function CheckSummary({ check }: { check: PostCheck }) {
  const accuracy =
    check.sourceAccuracy === null
      ? 'inga hänvisningar'
      : // From the counts, since e.g. 0.29 × 100 is 28.999… in floating point.
        `${Math.floor((check.valid * 100) / check.references)} % (${check.valid} av ${check.references} hänvisningar)`;
  return (
    <div className="check">
      <p className="lead">{SECTION_LEADS.check}</p>
      <p>
        <span>
          Källträffsäkerhet: {accuracy} · {check.flags.length} flaggade
        </span>{' '}
        <Info measure="sourceAccuracy" /> <Info measure="flagged" />
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<string>();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Kopierat');
    } catch {
      setStatus('Kunde inte kopiera');
    }
  }
  return (
    <p>
      <button type="button" onClick={copy}>
        Kopiera utkastet
      </button>{' '}
      {status && <span role="status">{status}</span>}
    </p>
  );
}
