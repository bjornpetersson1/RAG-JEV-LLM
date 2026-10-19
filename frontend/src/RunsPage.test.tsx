import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { LoggedRequest, RunLogEntry, RunsPage as Page } from './runs';
import { RunsPage } from './RunsPage';

function entry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    timestamp: '2026-10-13T12:00:00.000Z',
    runId: 'a',
    source: 'api',
    flow: 'main',
    template: 'employment',
    instruction: 'Säljare med provision',
    configuration: { retriever: 'tags', generator: 'fake', topK: 8 },
    timings: {
      translationMs: 7000,
      searchMs: 2,
      judgingMs: 26_000,
      sourcesMs: 26_002,
      totalMs: 70_000,
    },
    counts: { tags: 12, candidates: 30, fallback: 0, approved: 8, sent: 8, cited: 7 },
    judging: { relevant: 9, cacheHits: 0, judgeCalls: 30, unknown: 0 },
    sourceAccuracy: 0.97,
    ...overrides,
  };
}

const PAIR: LoggedRequest = {
  runId: 'a',
  timestamp: '2026-10-13T12:00:00.000Z',
  flows: [
    entry(),
    entry({
      flow: 'reference',
      timings: {
        searchMs: 220,
        embeddingMs: 210,
        judgingMs: 27_000,
        sourcesMs: 27_220,
        totalMs: 64_000,
      },
    }),
  ],
};

const FAILED: LoggedRequest = {
  runId: 'b',
  timestamp: '2026-10-13T11:00:00.000Z',
  flows: [
    entry({
      runId: 'b',
      template: 'nda',
      instruction: '',
      defaultInstruction: 'Sekretessavtal enligt mallen.',
      timings: { searchMs: 3 },
      counts: undefined,
      sourceAccuracy: undefined,
      error: 'The judge timed out',
    }),
  ],
};

/** Stubs `fetch`: `/api/runs` answers `pages(url)`, `/api/health` ok. */
function stubRuns(pages: (url: URL) => Page) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url === '/api/health'
        ? Response.json({ status: 'ok' })
        : Response.json(pages(new URL(url, 'http://localhost'))),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const page = (requests: LoggedRequest[], overrides: Partial<Page> = {}): Page => ({
  requests,
  total: requests.length,
  page: 1,
  pageSize: 20,
  ...overrides,
});

describe('RunsPage', () => {
  afterEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('lists each request with its flows’ time to sources and total, or its error', async () => {
    stubRuns(() => page([PAIR, FAILED]));
    render(<RunsPage />);

    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Anställningsavtal · Säljare med provision'),
      expect.stringContaining('Sekretessavtal · Sekretessavtal enligt mallen.'),
    ]);
    expect(items[0].textContent).toContain('Huvudflödet: källor 26,0 s, totalt 70,0 s');
    expect(items[0].textContent).toContain('Referens-RAG: källor 27,2 s, totalt 64,0 s');
    expect(items[1].textContent).toContain('Huvudflödet: fel: The judge timed out');
    expect(items.map((item) => item.querySelector('.run-source')?.textContent)).toEqual([
      'UI',
      'UI',
    ]);
    expect(screen.getByText('Sida 1 av 1 (2 körningar)', { exact: false })).toBeDefined();
  });

  it('asks the backend again with a filter, from the first page', async () => {
    const fetchMock = stubRuns((url) =>
      url.searchParams.get('template') === 'nda' ? page([FAILED]) : page([PAIR, FAILED]),
    );
    render(<RunsPage />);
    await screen.findAllByRole('listitem');

    fireEvent.change(screen.getByLabelText('Avtalstyp'), { target: { value: 'nda' } });

    await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/runs?page=1&template=nda');

    fireEvent.change(screen.getByLabelText('Flöde'), { target: { value: 'reference' } });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/runs?page=1&template=nda&flow=reference'),
    );
  });

  it('shows each request’s source, filters on it, and shows a benchmark run’s query and run', async () => {
    const bench = (overrides: Partial<RunLogEntry>) =>
      entry({
        runId: 'c',
        source: 'bench',
        bench: { queryId: 'q03', run: 2, runs: 5 },
        ...overrides,
      });
    const BENCH: LoggedRequest = {
      runId: 'c',
      timestamp: '2026-10-13T13:00:00.000Z',
      flows: [bench({}), bench({ flow: 'reference' })],
    };
    const CLI: LoggedRequest = {
      ...FAILED,
      flows: FAILED.flows.map((flow) => ({ ...flow, source: 'cli' })),
    };
    const fetchMock = stubRuns((url) =>
      url.searchParams.get('source') === 'bench' ? page([BENCH]) : page([BENCH, PAIR, CLI]),
    );
    render(<RunsPage />);

    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => item.querySelector('.run-source')?.textContent)).toEqual([
      'Benchmark (q03, körning 2 av 5)',
      'UI',
      'Terminal',
    ]);
    const source = screen.getByLabelText('Källa');
    expect(
      within(source)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Alla', 'UI', 'Terminal', 'Benchmark']);

    fireEvent.change(screen.getByLabelText('Flöde'), { target: { value: 'main' } });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/runs?page=1&flow=main'),
    );
    await screen.findAllByRole('listitem');
    fireEvent.change(source, { target: { value: 'bench' } });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/api/runs?page=1&flow=main&source=bench'),
    );
    await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /Benchmark/ }));
    expect(screen.getByText('Källa: Benchmark (q03, körning 2 av 5)')).toBeDefined();
  });

  it('shows no old rows under a new filter while it loads', async () => {
    let answer: (page: Page) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('template=nda')
          ? new Promise<Response>((resolve) => {
              answer = (result) => resolve(Response.json(result));
            })
          : Promise.resolve(Response.json(page([PAIR]))),
      ),
    );
    render(<RunsPage />);
    await screen.findAllByRole('listitem');

    fireEvent.change(screen.getByLabelText('Avtalstyp'), { target: { value: 'nda' } });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('Hämtar körningar…');
    await act(async () => answer(page([FAILED])));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('takes the template’s default instruction from whichever flow logged it', async () => {
    const failedMain = entry({ instruction: '', error: 'boom', timings: { searchMs: 1 } });
    const reference = entry({
      flow: 'reference',
      instruction: '',
      defaultInstruction: 'Anställningsavtal enligt mallen.',
    });
    stubRuns(() => page([{ ...PAIR, flows: [failedMain, reference] }]));
    render(<RunsPage />);

    const [item] = await screen.findAllByRole('listitem');
    expect(item.textContent).toContain('Anställningsavtal · Anställningsavtal enligt mallen.');
  });

  it('pages forward and back', async () => {
    const fetchMock = stubRuns((url) =>
      page(url.searchParams.get('page') === '2' ? [FAILED] : [PAIR], { total: 21, page: 1 }),
    );
    render(<RunsPage />);
    await screen.findAllByRole('listitem');
    expect((screen.getByRole('button', { name: 'Föregående' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Nästa' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/runs?page=2'));
    expect(await screen.findByText('Sida 2 av 2', { exact: false })).toBeDefined();
    expect((screen.getByRole('button', { name: 'Nästa' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('opens a request with its timing panel, counts and info texts, and – for what it lacks', async () => {
    stubRuns(() => page([PAIR, FAILED]));
    render(<RunsPage />);
    const [first] = await screen.findAllByRole('button', {
      name: /Säljare|Sekretessavtal enligt/,
    });

    fireEvent.click(first);

    const panel = screen.getByRole('region', { name: 'Tidspanel' });
    const sources = within(panel).getByRole('rowheader', { name: 'Tid till källor' });
    expect(
      within(sources.closest('tr') as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['26,0 s', '27,2 s']);
    const main = screen.getByRole('region', { name: 'Huvudflödet' });
    expect(
      within(main).getByRole('rowheader', { name: 'Citerade' }).closest('tr')?.textContent,
    ).toContain('7');
    expect(within(main).getByRole('button', { name: 'Vad betyder kandidater?' })).toBeDefined();
    expect(within(main).getByText('97 %')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Tillbaka till listan' }));
    fireEvent.click(await screen.findByRole('button', { name: /Sekretessavtal enligt/ }));

    const failed = screen.getByRole('region', { name: 'Huvudflödet' });
    expect(within(failed).getByText('Körningen misslyckades: The judge timed out')).toBeDefined();
    expect(
      within(failed).getByRole('rowheader', { name: 'Kandidater' }).closest('tr')?.textContent,
    ).toContain('–');
    expect(screen.getByText('Referens-RAG:en kördes inte.')).toBeDefined();
  });

  it('says so when the backend cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    render(<RunsPage />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Kunde inte nå servern. Kontrollera att backend körs.',
    );
  });
});

describe('the views', () => {
  afterEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('switches to the earlier runs at #korningar and back', async () => {
    stubRuns(() => page([PAIR]));
    render(<App />);
    expect(screen.queryByRole('region', { name: 'Tidigare körningar' })).toBeNull();

    await act(async () => {
      window.location.hash = '#korningar';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(screen.getByRole('region', { name: 'Tidigare körningar' })).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Tidigare körningar' }).getAttribute('aria-current'),
    ).toBe('page');

    await act(async () => {
      window.location.hash = '';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.queryByRole('region', { name: 'Tidigare körningar' })).toBeNull();
  });
});
