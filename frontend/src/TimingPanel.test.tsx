import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import type { FlowState } from './FlowProgress';
import { DEMO_NOTICE } from './explanations';
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

  it('shows both flows side by side on one scale, with both judges, time to sources, tokens and both differences', () => {
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
      planned: ['search', 'rerank', 'generation'],
      steps: {},
      result: queryResult({
        flow: 'reference',
        timings: {
          embeddingMs: 300,
          searchMs: 320,
          judgingMs: 2500,
          sourcesMs: 2820,
          generationMs: 9680,
          totalMs: 20_000,
        },
        judging: { cacheHits: 5, judgeCalls: 25, relevant: 6, unknown: 0 },
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
    expect(row('Rerank')[1]).toBe('2,5 s (100 ms per bedömd kandidat · 5 cacheträffar)');
    expect(row('Tid till källor')).toEqual(['3,0 s', '2,8 s']);
    expect(row('Generering')[0]).toBe('6,0 s (1\u00a0200 tokens, 5 ms/token)');
    expect(
      screen.getByText(
        'Huvudflödet hade sina källor 190 ms efter referens-RAG:en utan översättningen, och 1,2 s efter med översättningen till taggar (1,0 s).',
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        'Skillnaden består av översättningen till taggar (1,0 s, bara i huvudflödet), sökningen ' +
          '(10 ms mot 320 ms) och domarens bedömning (3,0 s mot 2,5 s). Räknat med översättningen ' +
          'visste referens-RAG:en först vilka källor utkastet skulle bygga på.',
      ),
    ).toBeDefined();
    expect(
      screen.getByText('Totalt var huvudflödet 10,0 s snabbare än referens-RAG:en.'),
    ).toBeDefined();
    expect(screen.getByText(DEMO_NOTICE)).toBeDefined();
    const bars = [...document.querySelectorAll<HTMLElement>('tr.total .bar')].map(
      (bar) => bar.style.width,
    );
    expect(bars).toEqual(['50%', '100%']);
    expect(screen.queryByText('Referens-RAG:en kördes inte.')).toBeNull();
  });
});

describe('the comparison', () => {
  afterEach(cleanup);

  it('says the main flow knew its sources first when it did, also with the translation', () => {
    const main: FlowState = {
      planned: ['translation', 'search', 'rerank', 'generation'],
      steps: {},
      result: queryResult({
        timings: {
          translationMs: 500,
          searchMs: 5,
          judgingMs: 1000,
          sourcesMs: 1005,
          totalMs: 6000,
        },
      }),
    };
    const reference: FlowState = {
      planned: ['search', 'rerank', 'generation'],
      steps: {},
      result: queryResult({
        flow: 'reference',
        timings: { searchMs: 300, judgingMs: 2000, sourcesMs: 2300, totalMs: 7000 },
      }),
    };
    render(<TimingPanel flows={{ main, reference }} reference running={false} />);

    expect(
      screen.getByText(
        'Huvudflödet hade sina källor 1,3 s före referens-RAG:en utan översättningen, och 795 ms före med översättningen till taggar (500 ms).',
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        /Räknat med översättningen visste huvudflödet först vilka källor utkastet skulle bygga på\.$/,
      ),
    ).toBeDefined();
    expect(screen.getByText(DEMO_NOTICE)).toBeDefined();
  });
});

describe('the comparison without a translation step', () => {
  afterEach(cleanup);

  it('names the flow that knew its sources first without counting a translation', () => {
    const done = (flow: 'main' | 'reference', sourcesMs: number): FlowState => ({
      planned: ['search', 'rerank', 'generation'],
      steps: {},
      result: queryResult({
        flow,
        timings: {
          searchMs: 100,
          judgingMs: sourcesMs - 100,
          sourcesMs,
          totalMs: sourcesMs + 1000,
        },
      }),
    });
    render(
      <TimingPanel
        flows={{ main: done('main', 2000), reference: done('reference', 3000) }}
        reference
        running={false}
      />,
    );

    expect(
      screen.getByText(
        'Skillnaden består av sökningen (100 ms mot 100 ms) och domarens bedömning (1,9 s mot 2,9 s). ' +
          'Huvudflödet visste först vilka källor utkastet skulle bygga på.',
      ),
    ).toBeDefined();
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
