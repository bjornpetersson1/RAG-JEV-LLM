import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import type { FlowState } from './FlowProgress';
import { formatMs, TimingPanel } from './TimingPanel';
import { controlledStream, queryResult, stubFetch } from './test-helpers';

const CONFIGURATION = {
  retriever: 'tags',
  tagIndex: 'roaring',
  translator: 'claude-code claude-haiku-5-5',
  reranker: 'minilm cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 int8',
  generator: 'claude-code claude-sonnet-5-5',
  topK: 8,
};

/** The text in the row for `label`, one cell per flow. */
function row(label: string): string[] {
  const header = screen.getByRole('rowheader', { name: label });
  return within(header.closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
}

describe('TimingPanel', () => {
  afterEach(cleanup);

  it('shows each step and the total, with – for a step the flow did not run', () => {
    const main: FlowState = {
      planned: ['search', 'rerank', 'generation'],
      configuration: CONFIGURATION,
      steps: {
        search: {
          step: 'search',
          candidates: 40,
          fallback: 0,
          timings: { searchMs: 420, embeddingMs: 400 },
        },
      },
      result: queryResult({
        candidates: 40,
        judging: { cacheHits: 0, judgeCalls: 40, relevant: 8, unknown: 0 },
        timings: {
          embeddingMs: 400,
          searchMs: 420,
          judgingMs: 4000,
          sourcesMs: 4420,
          totalMs: 4500,
        },
      }),
    };
    render(<TimingPanel flows={{ main }} reference={false} running={false} />);

    expect(row('Översättning')).toEqual(['–']);
    expect(row('Sökning')).toEqual(['420 ms']);
    expect(row('varav inbäddning')).toEqual(['400 ms']);
    expect(row('Rerank')).toEqual(['4,0 s (100 ms per bedömd kandidat)']);
    expect(row('Generering')).toEqual(['–']);
    expect(row('Totalt')).toEqual(['4,5 s']);
    expect(screen.getByText('Referens-RAG:en kördes inte.')).toBeDefined();
    expect(
      screen.getByText(
        'Huvudflödet: hämtning tags · taggindex roaring · översättare claude-code claude-haiku-5-5 · ' +
          'reranker minilm cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 int8 · högst 8 källor · ' +
          'generator claude-code claude-sonnet-5-5',
      ),
    ).toBeDefined();
  });

  it('shows – instead of … for the steps a failed run never reached', () => {
    const main: FlowState = {
      planned: ['search', 'rerank', 'generation'],
      steps: { search: { step: 'search', candidates: 30, fallback: 0, timings: { searchMs: 9 } } },
    };
    render(<TimingPanel flows={{ main }} reference={false} running={false} />);

    expect(row('Rerank')).toEqual(['–']);
    expect(row('Totalt')).toEqual(['–']);
  });

  it('says why the reference RAG was skipped', () => {
    const main: FlowState = { planned: ['search'], steps: {}, result: queryResult() };
    render(
      <TimingPanel
        flows={{ main }}
        reference
        skipped="run `npm run index:embed`"
        running={false}
      />,
    );

    expect(
      screen.getByText('Referens-RAG:en kördes inte: run `npm run index:embed`'),
    ).toBeDefined();
  });

  it('shows both flows side by side on one scale, with time to sources, tokens and both differences', () => {
    const main: FlowState = {
      planned: ['translation', 'search', 'rerank', 'generation'],
      steps: {},
      result: queryResult({
        timings: {
          translationMs: 1000,
          searchMs: 10,
          judgingMs: 3000,
          sourcesMs: 3010,
          generationMs: 6000,
          totalMs: 10_000,
        },
        judging: { cacheHits: 2, judgeCalls: 28, relevant: 8, unknown: 0 },
        usage: { generation: { outputTokens: 1200 } },
      }),
    };
    const reference: FlowState = {
      planned: ['search', 'generation'],
      steps: {},
      result: queryResult({
        flow: 'reference',
        timings: {
          embeddingMs: 300,
          searchMs: 320,
          sourcesMs: 320,
          generationMs: 9680,
          totalMs: 20_000,
        },
      }),
    };
    render(<TimingPanel flows={{ main, reference }} reference running={false} />);

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Steg',
      'Huvudflödet',
      'Referens-RAG',
    ]);
    expect(row('Totalt')).toEqual(['10,0 s', '20,0 s']);
    expect(row('Rerank')[0]).toContain('2 cacheträffar');
    expect(row('Rerank')[1]).toBe('–');
    expect(row('Tid till källor')).toEqual(['3,0 s', '320 ms']);
    expect(row('Generering')[0]).toBe('6,0 s (1\u00a0200 tokens, 5 ms/token)');
    expect(
      screen.getByText(
        'Huvudflödet hade sina källor 2,7 s efter referens-RAG:en utan översättningen, och 3,7 s efter med översättningen till taggar (1,0 s).',
      ),
    ).toBeDefined();
    expect(
      screen.getByText('Totalt var huvudflödet 10,0 s snabbare än referens-RAG:en.'),
    ).toBeDefined();
    const bars = [...document.querySelectorAll<HTMLElement>('tr.total .bar')].map(
      (bar) => bar.style.width,
    );
    expect(bars).toEqual(['50%', '100%']);
    expect(screen.queryByText('Referens-RAG:en kördes inte.')).toBeNull();
  });
});

describe('the timing panel during a query', () => {
  afterEach(cleanup);

  it('shows each step’s time as its event arrives, and … for the steps still running', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    fireEvent.click(screen.getByLabelText('Anställningsavtal'));
    fireEvent.click(screen.getByRole('button', { name: 'Skapa utkast' }));

    await act(async () => {
      stream.send({
        type: 'start',
        flow: 'main',
        steps: ['translation', 'search', 'rerank', 'generation'],
        configuration: CONFIGURATION,
      });
      stream.step({ step: 'translation', tags: [], timings: { translationMs: 800 } });
    });

    expect(await screen.findByRole('region', { name: 'Tidspanel' })).toBeDefined();
    expect(row('Översättning')).toEqual(['800 ms']);
    expect(row('Sökning')).toEqual(['…']);
    // A bar while the flow runs, on the scale of the times so far.
    expect(document.querySelector<HTMLElement>('tbody .bar')?.style.width).toBe('100%');

    await act(async () =>
      stream.step({ step: 'search', candidates: 30, fallback: 0, timings: { searchMs: 12 } }),
    );
    expect(row('Sökning')).toEqual(['12 ms']);
    expect(row('Totalt')).toEqual(['…']);
  });
});

describe('formatMs', () => {
  it.each([
    [340, '340 ms'],
    [999.6, '1,0 s'],
    [1000, '1,0 s'],
    [12_449, '12,4 s'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatMs(ms)).toBe(text);
  });
});
