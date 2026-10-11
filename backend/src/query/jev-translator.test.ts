import { describe, expect, it } from 'vitest';
import { createJevClient } from '../jev/client.js';
import { createCapturingLogger } from '../llm/test-helpers.js';
import { createJevQueryTranslator } from './jev-translator.js';
import { createFakeJev, VOCABULARY } from './test-helpers.js';

const JEV = {
  apiKey: 'k',
  baseUrl: 'https://jev.example/v1',
  model: 'jev-latest',
  timeoutMs: 1000,
};

function translatorWith(fake: ReturnType<typeof createFakeJev>, threshold = 0.5) {
  const client = createJevClient({
    ...JEV,
    role: 'queryTranslator',
    logger: createCapturingLogger(),
    fetch: fake.fetch,
  });
  return createJevQueryTranslator(client, threshold);
}

describe('createJevQueryTranslator', () => {
  it('asks a Choice question over the areas, then Noul questions for the tags of the chosen areas', async () => {
    const fake = createFakeJev({ lon: 0.6, skadestand: 0.3, sekretess: 0, semester: 0.1 }, {});

    await translatorWith(fake).translate('Anställningsavtal med bonus', VOCABULARY);

    const [areaRequest, ...tagRequests] = fake.requests.map((request) => request.body);
    expect(areaRequest).toEqual({
      state: 'Anställningsavtal med bonus',
      model: 'jev-latest',
      questions: {
        area: {
          type: 'choice',
          instructions: 'Vilket rättsområde handlar texten om?',
          criteria: {
            lon: 'Lön och förmåner',
            skadestand: 'Skadestånd, vite och påföljder',
            sekretess: 'Sekretess, företagshemligheter och lojalitetsplikt',
            semester: 'Semester',
          },
        },
      },
    });
    // The three most probable areas, one call each; an area at probability 0 is never asked about.
    expect(tagRequests.map((body) => Object.keys(body.questions as object))).toEqual([
      ['lon', 'bonus', 'provision'],
      ['vite', 'skadestand', 'ranta'],
      ['semesterlon', 'semesterdagar', 'sparade-dagar'],
    ]);
    expect(tagRequests.every((body) => body.state === 'Anställningsavtal med bonus')).toBe(true);
    expect((tagRequests[0].questions as Record<string, unknown>).bonus).toEqual({
      type: 'noul',
      instructions: 'Handlar texten om bonus i avtalet?',
    });
  });

  it('selects tags at or above the threshold, highest score first, with the scores', async () => {
    const fake = createFakeJev(
      { lon: 0.7, skadestand: 0.3 },
      { lon: 0.5, bonus: 0.9, provision: 0.49, vite: 0.6 },
    );

    const translation = await translatorWith(fake).translate('Bonus och vite', VOCABULARY);

    expect(translation.tags).toEqual([
      { slug: 'bonus', score: 0.9 },
      { slug: 'vite', score: 0.6 },
      { slug: 'lon', score: 0.5 },
    ]);
    expect(translation.areaScores).toEqual({ lon: 0.7, skadestand: 0.3 });
    // One Choice call and two area calls, 10 input and 1 output token each in the fake.
    expect(translation.usage).toMatchObject({ inputTokens: 30, outputTokens: 3 });
    expect(translation.askedTags).toHaveLength(6);
    expect(translation.askedTags).toContainEqual({ slug: 'provision', score: 0.49 });
  });

  it('keeps at most 8 tags', async () => {
    const scores = Object.fromEntries(VOCABULARY.map((tag, i) => [tag.slug, 0.9 - i * 0.01]));
    const fake = createFakeJev({ lon: 0.5, skadestand: 0.3, sekretess: 0.2 }, scores);

    const { tags } = await translatorWith(fake).translate('Allt', VOCABULARY);

    expect(tags.map((tag) => tag.slug)).toEqual([
      'lon',
      'bonus',
      'provision',
      'vite',
      'skadestand',
      'ranta',
      'sekretessklausul',
      'foretagshemlighet',
    ]);
  });

  it('uses the single chosen area when no probabilities are given', async () => {
    const fake = createFakeJev({}, { sekretessklausul: 0.8 });
    const client = createJevClient({
      ...JEV,
      role: 'queryTranslator',
      logger: createCapturingLogger(),
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          questions: Record<string, { type: string }>;
        };
        if ('area' in body.questions) {
          return Response.json({
            answers: { area: { type: 'choice', choice: 'sekretess', probabilities: {} } },
          });
        }
        return fake.fetch(url, init);
      },
    });

    const { tags } = await createJevQueryTranslator(client, 0.5).translate('NDA', VOCABULARY);

    expect(tags).toEqual([{ slug: 'sekretessklausul', score: 0.8 }]);
  });

  it('returns no tags, without an error, when nothing reaches the threshold', async () => {
    const fake = createFakeJev({ lon: 1 }, { lon: 0.2 });

    await expect(translatorWith(fake).translate('Väder', VOCABULARY)).resolves.toMatchObject({
      tags: [],
    });
  });

  it('leaves out excluded tags before the cap', async () => {
    const fake = createFakeJev({ lon: 0.7 }, { lon: 0.9, bonus: 0.8, provision: 0.7 });

    const { tags } = await translatorWith(fake).translate('Lön', VOCABULARY, {
      exclude: new Set(['lon']),
    });

    expect(tags.map((tag) => tag.slug)).toEqual(['bonus', 'provision']);
  });

  it('cancels the other area calls when one fails', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const client = createJevClient({
      ...JEV,
      role: 'queryTranslator',
      logger: createCapturingLogger(),
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
        if ('area' in body.questions) {
          return Response.json({
            answers: {
              area: { type: 'choice', choice: 'lon', probabilities: { lon: 0.6, semester: 0.4 } },
            },
          });
        }
        signals.push(init?.signal ?? undefined);
        if ('lon' in body.questions) return new Response('down', { status: 503 });
        // The semester call waits until it is cancelled.
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
        );
      },
    });

    await expect(createJevQueryTranslator(client, 0.5).translate('x', VOCABULARY)).rejects.toThrow(
      'JEV answered HTTP 503',
    );
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
  });

  it('fails when a JEV call fails', async () => {
    const client = createJevClient({
      ...JEV,
      role: 'queryTranslator',
      logger: createCapturingLogger(),
      fetch: async () => new Response('down', { status: 503 }),
    });

    await expect(
      createJevQueryTranslator(client, 0.5).translate('NDA', VOCABULARY),
    ).rejects.toThrow('JEV answered HTTP 503');
  });
});
