import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  demoNotice,
  EXPLANATIONS,
  introduction,
  SECTION_LEADS,
  type Measure,
} from './explanations';
import type { FlowState } from './FlowProgress';
import { ResultView } from './ResultView';
import { chunk, queryResult, SAME_JUDGE_CONFIG, stubFetch, SUBQ_CONFIG } from './test-helpers';
import { TimingPanel } from './TimingPanel';

/** The measures the timing panel, the source list and the result view show (E7-11). */
const SHOWN: Measure[] = [
  'translation',
  'search',
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

/** The details explained under another measure's button. */
const UNDER: Partial<Record<Measure, Measure>> = {
  rerankDetail: 'rerank',
  generationDetail: 'generation',
};

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
    // A timing row's detail is explained under the row's own button.
    const { name } = EXPLANATIONS[UNDER[measure] ?? measure];
    const { text } = EXPLANATIONS[measure];
    const [button] = screen.getAllByRole('button', { name: `Vad betyder ${name}?` });

    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(text.trim()).not.toBe('');
    expect(
      document.getElementById(button.getAttribute('aria-controls') ?? '')?.textContent,
    ).toContain(text);
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

  it('introduces the configured comparison above the form', async () => {
    stubFetch(() => new Promise(() => {}), SUBQ_CONFIG);
    render(<App />);

    expect(await screen.findByText(introduction(SUBQ_CONFIG))).toBeDefined();
  });

  it('asks for the configuration again until the backend answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let attempts = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url === '/api/config' && attempts++ === 0) {
            return Promise.reject(new TypeError('Failed to fetch'));
          }
          return Promise.resolve(
            Response.json(url === '/api/config' ? SUBQ_CONFIG : { status: 'ok' }),
          );
        }),
      );
      render(<App />);
      expect(screen.getByText(introduction())).toBeDefined();

      await vi.advanceTimersByTimeAsync(2000);

      expect(await screen.findByText(introduction(SUBQ_CONFIG))).toBeDefined();
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('introduces the comparison without a claim about the judges when the backend is away', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByText('Backend: unreachable');
    expect(fetchMock).toHaveBeenCalledWith('/api/config');
    const text = screen.getByText(introduction()).textContent ?? '';
    expect(text).toContain('Båda låter sedan en domare välja de relevanta källorna');
    expect(text).not.toContain('samma AI-domare');
    expect(text).not.toContain('SubQ');
  });
});

describe('introduction', () => {
  it('names the small judge and the LLM judge when the flows judge differently', () => {
    const text = introduction(SUBQ_CONFIG);

    expect(text).toContain(
      'Sedan väljer en liten domarmodell (SubQ) huvudflödets källor och AI-domaren (LLM) ' +
        'referens-RAG:ens.',
    );
    expect(text).toContain('skillnaden ligger både i hur källorna hittas och i hur de bedöms');
    expect(text).not.toContain('samma AI-domare');
  });

  it('says both use the same judge with the LLM judge in both flows, as before E7-14', () => {
    expect(introduction(SAME_JUDGE_CONFIG)).toBe(
      'Här jämförs två sätt att hitta källor till ett avtalsutkast. Huvudflödet översätter i ' +
        'standardinställningen din instruktion till juridiska ämnestaggar och söker på dem; ' +
        'referens-RAG:en söker i stället direkt på instruktionens ord (BM25). Båda låter sedan ' +
        'samma AI-domare välja de relevanta källorna, och samma AI skriver utkastet, så skillnaden ' +
        'ligger i hur källorna hittas. Under tabellen står vad varje flöde körde med.',
    );
  });

  it('names the other judges by type, and an unknown one by its name', () => {
    const withMain = (name: string) =>
      introduction({ ...SUBQ_CONFIG, judges: { ...SUBQ_CONFIG.judges, main: { name } } });

    expect(withMain('jev')).toContain('väljer en liten domarmodell (JEV) huvudflödets');
    expect(withMain('qwen3')).toContain('väljer qwen3 huvudflödets');
    expect(withMain('constructor')).toContain('väljer constructor huvudflödets');
  });
});

describe('demoNotice', () => {
  const DEMO = 'Siffrorna här är en demonstration.';
  const MEASUREMENT =
    'Den egentliga mätningen görs med npm run bench:compare, som kör alla testfrågor utan ' +
    'sparade svar.';

  it('says the reference RAG can reuse the judgements with the same judge and the cache on', () => {
    expect(demoNotice(SAME_JUDGE_CONFIG)).toBe(
      `${DEMO} Domarens svar sparas, och referens-RAG:en körs efter huvudflödet med samma ` +
        'instruktion, så den kan återanvända huvudflödets bedömningar och verka snabbare. ' +
        MEASUREMENT,
    );
  });

  it('does not mention reuse when the flows judge differently', () => {
    expect(demoNotice(SUBQ_CONFIG)).toBe(
      `${DEMO} Bedömningar från en tidigare körning av samma instruktion kan återanvändas, så en ` +
        `upprepad instruktion kan gå snabbare. ${MEASUREMENT}`,
    );
  });

  it('mentions neither saved answers nor reuse with the cache off or without the configuration', () => {
    expect(demoNotice({ ...SAME_JUDGE_CONFIG, judgeCache: false })).toBe(`${DEMO} ${MEASUREMENT}`);
    expect(demoNotice()).toBe(`${DEMO} ${MEASUREMENT}`);
  });
});
