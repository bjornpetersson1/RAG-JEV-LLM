import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { QueryStepName } from './query';
import { controlledStream, queryResult, stubFetch } from './test-helpers';

const RESULT = queryResult();

const MAIN_STEPS: QueryStepName[] = ['translation', 'search', 'rerank', 'generation'];

/** Fills in the form and submits it; `reference` sets the reference RAG option (on by default). */
function submitForm({ template = 'Anställningsavtal', instruction = '', reference = true } = {}) {
  fireEvent.click(screen.getByLabelText(template));
  if (instruction) {
    fireEvent.change(screen.getByLabelText('Instruktion (valfri)'), {
      target: { value: instruction },
    });
  }
  const option = screen.getByLabelText('Kör även referens-RAG för jämförelse') as HTMLInputElement;
  if (option.checked !== reference) fireEvent.click(option);
  fireEvent.click(screen.getByRole('button', { name: 'Skapa utkast' }));
}

function queryBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/query') ?? [];
  return JSON.parse(String(init?.body));
}

describe('App', () => {
  afterEach(cleanup);

  it('shows the backend health status', async () => {
    const fetchMock = stubFetch(() => new Promise(() => {}));

    render(<App />);

    expect(await screen.findByText('Backend: ok')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it.each([
    [
      'the backend answers with an error',
      () => Promise.resolve(new Response(null, { status: 502 })),
    ],
    ['the backend answers with an unexpected body', () => Promise.resolve(Response.json({}))],
    ['the request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('shows unreachable when %s', async (_case, fetchImplementation) => {
    vi.stubGlobal('fetch', vi.fn(fetchImplementation));

    render(<App />);

    expect(await screen.findByText('Backend: unreachable')).toBeDefined();
  });
});

describe('the query form', () => {
  afterEach(cleanup);

  it('cannot be submitted without a contract type', () => {
    stubFetch(() => new Promise(() => {}));
    render(<App />);

    expect(screen.getByRole('button', { name: 'Skapa utkast' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it.each([
    [
      'the template alone, with the reference RAG on by default',
      {},
      { template: 'employment', instruction: '', reference: true },
    ],
    [
      'the template with free text and without the reference RAG',
      { template: 'Sekretessavtal', instruction: ' Konsult med kunddata ', reference: false },
      { template: 'nda', instruction: 'Konsult med kunddata', reference: false },
    ],
  ])('starts the same query from %s', async (_case, form, body) => {
    const fetchMock = stubFetch(() => new Promise(() => {}));
    render(<App />);

    submitForm(form);

    await screen.findByRole('button', { name: 'Kör…' });
    expect(queryBody(fetchMock)).toEqual(body);
  });

  it('shows tags, candidates and approved chunks as each step arrives, then the draft', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm({ instruction: 'Säljare med provanställning' });

    await act(async () => stream.send({ type: 'start', flow: 'main', steps: MAIN_STEPS }));
    expect(await screen.findByText('Översätter frågan till taggar…')).toBeDefined();

    await act(async () =>
      stream.step({
        step: 'translation',
        tags: [
          { slug: 'anstallningsavtal', origin: 'preset' },
          { slug: 'provanstallning', origin: 'translated' },
        ],
        timings: { translationMs: 800 },
      }),
    );
    expect(await screen.findByText('anstallningsavtal (mall)')).toBeDefined();
    expect(screen.getByText('provanstallning (översatt)')).toBeDefined();
    expect(screen.getByText('Söker kandidater…')).toBeDefined();

    await act(async () =>
      stream.step({ step: 'search', candidates: 30, fallback: 6, timings: { searchMs: 3 } }),
    );
    expect(await screen.findByText('30 kandidater, varav 6 från fritextsökning')).toBeDefined();

    await act(async () =>
      stream.step({
        step: 'rerank',
        candidates: 30,
        judged: true,
        relevant: 12,
        unknown: 0,
        approved: 8,
        timings: { judgingMs: 30_000 },
      }),
    );
    expect(
      await screen.findByText('12 bedömda som relevanta av 30, de 8 bästa går vidare'),
    ).toBeDefined();
    expect(screen.getByText('Skriver utkast…')).toBeDefined();
    expect(screen.queryByText(/Text \[K:11\]/)).toBeNull();

    await act(async () => {
      stream.send({ type: 'result', flow: 'main', result: RESULT });
      stream.send({ type: 'done' });
      stream.end();
    });
    expect(await screen.findByText(/Text \[K:11\]/)).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Skapa utkast' })).toBeDefined();
  });

  it('follows the plan the backend sends: no translation step for a flow without one', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm();

    await act(async () =>
      stream.send({ type: 'start', flow: 'main', steps: ['search', 'rerank'] }),
    );

    expect(await screen.findByText('Söker kandidater…')).toBeDefined();
    expect(screen.queryByText('Översätter frågan till taggar…')).toBeNull();
  });

  it('says which instruction was used without free text, and shows the reference RAG after the main flow', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm({ reference: true });

    await act(async () => {
      stream.send({ type: 'start', flow: 'main', steps: MAIN_STEPS });
      stream.send({
        type: 'result',
        flow: 'main',
        result: { ...RESULT, defaultInstruction: 'Anställningsavtal' },
      });
      stream.send({ type: 'start', flow: 'reference', steps: ['search', 'generation'] });
      stream.step(
        { step: 'search', candidates: 8, fallback: 0, timings: { searchMs: 400 } },
        'reference',
      );
    });

    expect(
      await screen.findByText(
        'Ingen fritext angavs, så instruktionen "Anställningsavtal" användes.',
      ),
    ).toBeDefined();
    expect(screen.queryByText('Förbereder referens-RAG…')).toBeNull();
    const reference = screen.getByRole('region', { name: 'Referens-RAG' });
    expect(reference.textContent).toContain('8 närmaste chunkar skickas till generatorn');
    expect(reference.textContent).toContain('Skriver utkast…');
  });

  it.each([
    [
      'an error answer',
      () => Promise.resolve(Response.json({ error: 'boom' }, { status: 500 })),
      'Servern svarade med fel 500: boom',
    ],
    [
      'a query already running',
      () => Promise.resolve(Response.json({ error: 'busy' }, { status: 409 })),
      'En fråga körs redan. Vänta tills den är klar och försök igen.',
    ],
    [
      'an unreachable backend',
      () => Promise.reject(new TypeError('Failed to fetch')),
      'Kunde inte nå servern. Kontrollera att backend körs.',
    ],
  ])('shows the error for %s', async (_case, query, message) => {
    stubFetch(query);
    render(<App />);

    submitForm();

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.getByRole('button', { name: 'Skapa utkast' })).toBeDefined();
  });

  it('shows an error event from the stream', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm();

    await act(async () => {
      stream.send({ type: 'start', flow: 'main', steps: MAIN_STEPS });
      stream.send({ type: 'error', flow: 'main', message: 'LLM call failed' });
      stream.end();
    });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Fel i huvudflödet: LLM call failed',
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows that the answer broke off when the stream ends early', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm();

    await act(async () => {
      stream.send({ type: 'start', flow: 'main', steps: ['search', 'rerank'] });
      stream.step({ step: 'search', candidates: 3, fallback: 0, timings: { searchMs: 1 } });
      stream.end();
    });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Svaret från servern avbröts innan frågan var klar.',
    );
    expect(screen.getByText('3 kandidater')).toBeDefined();
  });

  it('says the reference RAG is being prepared between the main flow and its start', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm({ reference: true });

    await act(async () => {
      stream.send({ type: 'start', flow: 'main', steps: MAIN_STEPS });
      stream.send({ type: 'result', flow: 'main', result: RESULT });
    });

    expect(await screen.findByText('Förbereder referens-RAG…')).toBeDefined();
  });

  it('keeps the main flow’s result when the reference RAG is skipped, without an error', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));
    render(<App />);
    submitForm();

    await act(async () => {
      stream.send({ type: 'start', flow: 'main', steps: MAIN_STEPS });
      stream.send({ type: 'result', flow: 'main', result: RESULT });
      stream.send({ type: 'skipped', flow: 'reference', reason: 'run `npm run index:embed`' });
      stream.send({ type: 'done' });
      stream.end();
    });

    expect(
      await screen.findByText('Referens-RAG:en kördes inte: run `npm run index:embed`'),
    ).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Förbereder referens-RAG…')).toBeNull();
  });
});
