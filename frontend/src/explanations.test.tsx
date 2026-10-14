import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { EXPLANATIONS, INTRODUCTION, SECTION_LEADS, type Measure } from './explanations';
import type { FlowState } from './FlowProgress';
import { ResultView } from './ResultView';
import { chunk, queryResult, stubFetch } from './test-helpers';
import { TimingPanel } from './TimingPanel';

/** The measures the timing panel, the source list and the result view show (E7-11). */
const SHOWN: Measure[] = [
  'translation',
  'search',
  'embedding',
  'rerank',
  'rerankDetail',
  'sources',
  'generation',
  'generationDetail',
  'total',
  'comparison',
  'configuration',
  'sourceAccuracy',
  'flagged',
  'score',
  'origin',
  'cited',
  'sent',
  'notSent',
];

const CONFIGURATION = { retriever: 'tags', generator: 'fake', topK: 8 };

function flow(overrides: Partial<FlowState> = {}): FlowState {
  return {
    planned: ['translation', 'search', 'rerank', 'generation'],
    configuration: CONFIGURATION,
    steps: {},
    result: queryResult(),
    ...overrides,
  };
}

function renderEverything() {
  const cited = chunk('1', 'SFS 1982:80 7 §');
  const sent = chunk('2', 'SFS 1982:80 11 §');
  const turnedDown = chunk('3', 'AD 2015 nr 8');
  const result = queryResult({
    sources: [
      { chunk: cited, status: 'cited', origin: 'tag', score: 0.9, reranker: 'llm' },
      { chunk: sent, status: 'sent', origin: 'fts', score: 0.85, reranker: 'llm' },
      { chunk: turnedDown, status: 'turned-down', origin: 'tag', score: 0.1, reranker: 'llm' },
    ],
    draft: {
      text: 'Text [K:1].',
      used: [cited],
      unused: [sent],
      leftOut: [],
      check: { flags: [], matches: [], references: 1, valid: 1, sourceAccuracy: 1 },
    },
  });
  render(
    <>
      <TimingPanel
        flows={{ main: flow(), reference: flow({ result: queryResult({ flow: 'reference' }) }) }}
        reference
        running={false}
      />
      <ResultView flow="main" result={result} />
    </>,
  );
}

describe('info texts', () => {
  afterEach(cleanup);

  it.each(SHOWN)('%s has an (i) button that opens its text in place', (measure) => {
    renderEverything();
    const { name, text } = EXPLANATIONS[measure];
    const [button] = screen.getAllByRole('button', { name: `Vad betyder ${name}?` });

    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(text.trim()).not.toBe('');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')?.textContent).toBe(
      text,
    );
    fireEvent.click(button);
    expect(screen.queryByText(text)).toBeNull();
  });

  it('gives every section its sentence', () => {
    renderEverything();

    for (const lead of [SECTION_LEADS.timing, SECTION_LEADS.check]) {
      expect(screen.getByText(lead)).toBeDefined();
    }
    expect(screen.getByText(SECTION_LEADS.sources, { exact: false })).toBeDefined();
  });

  it('introduces the comparison above the form', () => {
    stubFetch(() => new Promise(() => {}));
    render(<App />);

    expect(screen.getByText(INTRODUCTION)).toBeDefined();
  });
});
