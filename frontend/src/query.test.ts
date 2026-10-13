import { describe, expect, it } from 'vitest';
import { QueryError, streamQuery, type QueryEvent } from './query';
import { controlledStream, stubFetch, type ControlledStream } from './test-helpers';

const REQUEST = { template: 'nda' as const, instruction: '', reference: false };

describe('streamQuery', () => {
  it('posts the request and passes each event on until done', async () => {
    const stream = controlledStream();
    const fetchMock = stubFetch(() => Promise.resolve(stream.response));
    const events: QueryEvent[] = [];

    const done = streamQuery(REQUEST, (event) => events.push(event));
    stream.send({ type: 'start', flow: 'main', steps: ['search'] });
    stream.step({ step: 'search', candidates: 3, fallback: 1, timings: { searchMs: 2 } });
    stream.send({ type: 'done' });
    stream.end();
    await done;

    expect(fetchMock).toHaveBeenCalledWith('/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    expect(events).toEqual([
      { type: 'start', flow: 'main', steps: ['search'] },
      {
        type: 'step',
        flow: 'main',
        step: 'search',
        candidates: 3,
        fallback: 1,
        timings: { searchMs: 2 },
      },
    ]);
  });

  it.each([
    [
      'an error answer, with its message',
      () => Promise.resolve(Response.json({ error: 'bad template' }, { status: 400 })),
      'Servern svarade med fel 400: bad template',
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
  ])('fails with a Swedish message for %s', async (_case, query, message) => {
    stubFetch(query);

    await expect(streamQuery(REQUEST, () => {})).rejects.toThrow(new QueryError(message));
  });

  it('fails with the backend’s text for an error event', async () => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));

    const done = streamQuery(REQUEST, () => {});
    stream.send({ type: 'error', flow: 'reference', message: 'run `npm run index:embed`' });
    stream.end();

    await expect(done).rejects.toThrow('Fel i referens-RAG:en: run `npm run index:embed`');
  });

  it.each([
    [
      'ends before done',
      (stream: ControlledStream) => stream.end(),
      'Svaret från servern avbröts innan frågan var klar.',
    ],
    [
      'sends a line that is not JSON',
      (stream: ControlledStream) => stream.send('<html>502</html>'),
      'Servern skickade ett ogiltigt svar.',
    ],
  ])('fails when the stream %s', async (_case, breakOff, message) => {
    const stream = controlledStream();
    stubFetch(() => Promise.resolve(stream.response));

    const done = streamQuery(REQUEST, () => {});
    breakOff(stream);

    await expect(done).rejects.toThrow(message);
  });
});
