import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostCheck, ReferenceFlag, ReferenceMatch } from './query';
import { ResultView } from './ResultView';
import { chunk, queryResult } from './test-helpers';

const LAS_7 = chunk('2', 'SFS 1982:80 7 §', 'https://lagen.nu/1982:80');
const LAS_11 = chunk('1', 'SFS 1982:80 11 §');
const UNCITED = chunk('3', 'SFS 1982:80 12 §');
const LEFT_OUT = chunk('5', 'SFS 1982:80 13 §');
const TURNED_DOWN = chunk('4', 'AD 2015 nr 8');

const TEXT =
  '# Anställningsavtal\n\nUppsägning enligt 7 § LAS [K:2, K:9]. Lön [K:1]. Se AD 2010 nr 61.';

/** The reference written as `written` in the draft, with its offsets. */
function at(written: string) {
  const start = TEXT.indexOf(written);
  return { text: written, start, end: start + written.length };
}

const CHECK: PostCheck = {
  matches: [
    { kind: 'free-text', ...at('7 § LAS'), chunkId: '2' },
    { kind: 'citation', ...at('[K:2, K:9]'), chunkId: '2' },
    { kind: 'citation', ...at('[K:1]'), chunkId: '1' },
  ] satisfies ReferenceMatch[],
  flags: [
    { kind: 'citation', ...at('[K:2, K:9]'), chunkId: '9', reason: 'chunk 9 was not submitted' },
    {
      kind: 'free-text',
      ...at('AD 2010 nr 61'),
      reason: 'no submitted chunk is from AD 2010 nr 61',
    },
  ] satisfies ReferenceFlag[],
  references: 5,
  valid: 3,
  sourceAccuracy: 0.6,
};

const RESULT = queryResult({
  approved: [LAS_7, LAS_11, UNCITED, LEFT_OUT],
  sources: [
    { chunk: LAS_7, status: 'cited', origin: 'tag', score: 0.91, reranker: 'bge' },
    { chunk: LAS_11, status: 'cited', origin: 'fts', score: 0.72, reranker: 'bge' },
    { chunk: UNCITED, status: 'sent', origin: 'tag', score: 0.55, reranker: 'bge' },
    { chunk: LEFT_OUT, status: 'left-out', origin: 'named', score: 0.51, reranker: 'bge' },
    { chunk: TURNED_DOWN, status: 'turned-down', origin: 'tag', score: 0.12, reranker: 'bge' },
  ],
  draft: {
    text: TEXT,
    used: [LAS_7, LAS_11],
    unused: [UNCITED],
    leftOut: [LEFT_OUT],
    check: CHECK,
  },
});

function sourceEntry(id: string): HTMLElement {
  const entry = document.getElementById(`source-main-${id}`);
  if (!entry) throw new Error(`no source entry ${id}`);
  return entry;
}

function isOpen(id: string): boolean {
  return sourceEntry(id).querySelector('details')?.open ?? false;
}

describe('ResultView', () => {
  afterEach(cleanup);

  it('renders the draft as Markdown, with the disclaimer', () => {
    render(<ResultView flow="main" result={RESULT} />);

    expect(screen.getByRole('heading', { name: 'Anställningsavtal' })).toBeDefined();
    expect(screen.getByText(/inte juridisk rådgivning/)).toBeDefined();
  });

  it.each([
    ['a single citation', '[K:1]', LAS_11],
    ['a citation in a group', '[K:2]', LAS_7],
    ['a matched free-text reference', '7 § LAS', LAS_7],
  ])('opens the chunk text when %s is clicked', (_case, link, cited) => {
    render(<ResultView flow="main" result={RESULT} />);
    expect(isOpen(cited.id)).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: link }));

    expect(isOpen(cited.id)).toBe(true);
    expect(sourceEntry(cited.id).className).toContain('highlighted');
    expect(within(sourceEntry(cited.id)).getByText(cited.text)).toBeDefined();
  });

  it('marks flagged references in red with the reason, not as links', () => {
    render(<ResultView flow="main" result={RESULT} />);

    const citation = screen.getByText('[K:9]');
    expect(citation.className).toBe('flagged');
    expect(citation.getAttribute('title')).toBe('Flaggad: chunk 9 was not submitted');
    expect(screen.getByText('AD 2010 nr 61').getAttribute('title')).toBe(
      'Flaggad: no submitted chunk is from AD 2010 nr 61',
    );
    expect(screen.queryByRole('link', { name: '[K:9]' })).toBeNull();
    expect(
      screen.getByText('Källträffsäkerhet: 60 % (3 av 5 hänvisningar) · 2 flaggade'),
    ).toBeDefined();
  });

  it('lists cited, sent but not cited, and not sent sources, with title, score, origin and link', () => {
    render(<ResultView flow="main" result={RESULT} />);

    expect(screen.getByRole('heading', { name: 'Citerade källor (2)' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Skickade men inte citerade (1)' })).toBeDefined();
    expect(screen.getByText('Inte skickade till generatorn (2)')).toBeDefined();
    expect(sourceEntry('2').textContent).toContain(
      'SFS 1982:80 7 § · Dokument 2 · poäng 0.91 (bge) · tagg',
    );
    expect(sourceEntry('1').textContent).toContain('poäng 0.72 (bge) · fritext');
    expect(sourceEntry('5').textContent).toContain('rymdes inte i kontexten');
    expect(sourceEntry('4').textContent).toContain('bortvald av rerankern');
    const original = within(sourceEntry('2')).getByRole('link', {
      name: 'Öppna originalkällan',
      hidden: true,
    });
    expect(original.getAttribute('href')).toBe('https://lagen.nu/1982:80');
    expect(original.getAttribute('target')).toBe('_blank');
    expect(within(sourceEntry('1')).queryByText('Öppna originalkällan')).toBeNull();
  });

  it('links each reference to its source entry’s id, so a new tab still finds it', () => {
    render(<ResultView flow="main" result={RESULT} />);

    expect(screen.getByRole('link', { name: '[K:1]' }).getAttribute('href')).toBe('#source-main-1');
  });

  it('counts a source the draft names only in free text as cited', () => {
    const named = chunk('6', 'SFS 1982:80 6 §');
    const text = 'Provanställning enligt 6 § LAS.';
    render(
      <ResultView
        flow="main"
        result={queryResult({
          approved: [named],
          sources: [{ chunk: named, status: 'cited', origin: 'tag' }],
          draft: {
            text,
            used: [],
            unused: [named],
            leftOut: [],
            check: {
              matches: [{ kind: 'free-text', text: '6 § LAS', start: 23, end: 30, chunkId: '6' }],
              flags: [],
              references: 1,
              valid: 1,
              sourceAccuracy: 1,
            },
          },
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Citerade källor (1)' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Skickade men inte citerade (0)' })).toBeDefined();
  });

  it('shows the source accuracy from the counts, so 29 of 100 is 29 %', () => {
    const check = { ...CHECK, references: 100, valid: 29, sourceAccuracy: 0.29 };
    render(<ResultView flow="main" result={{ ...RESULT, draft: { ...RESULT.draft!, check } }} />);

    expect(screen.getByText(/Källträffsäkerhet: 29 % \(29 av 100/)).toBeDefined();
  });

  it('copies the draft as written', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ResultView flow="main" result={RESULT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kopiera utkastet' }));

    expect(await screen.findByText('Kopierat')).toBeDefined();
    expect(writeText).toHaveBeenCalledWith(TEXT);
  });

  it('says why there is no draft, and still lists the candidates', () => {
    const sources = RESULT.sources.map((source) => ({ ...source, status: 'turned-down' as const }));
    render(
      <ResultView flow="main" result={{ ...RESULT, approved: [], sources, draft: undefined }} />,
    );

    expect(screen.getByText('Inget utkast skrevs: inga relevanta källor hittades.')).toBeDefined();
    expect(screen.getByText('Inte skickade till generatorn (5)')).toBeDefined();
  });

  it('says how many candidates could not be judged when nothing was found relevant', () => {
    const judging = { cacheHits: 0, judgeCalls: 5, relevant: 0, unknown: 5 };
    render(
      <ResultView flow="main" result={{ ...RESULT, approved: [], judging, draft: undefined }} />,
    );

    expect(
      screen.getByText(
        'Inget utkast skrevs: inga källor bedömdes som relevanta, och 5 kunde inte bedömas.',
      ),
    ).toBeDefined();
  });
});
