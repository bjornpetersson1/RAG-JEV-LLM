import { describe, expect, it } from 'vitest';
import { LlmError, NO_USAGE } from './client.js';
import { createFakeLlmClient } from './fakes.js';
import { loadPromptTemplate } from '../generation/templates.js';
import {
  createLlmGenerator,
  createLlmJudge,
  createLlmQueryTranslator,
  createLlmTagger,
} from './roles.js';

const VOCABULARY = [
  { slug: 'lon', label: 'Lön', description: 'lön och lönevillkor', area: 'lon' },
  { slug: 'bonus', label: 'Bonus', description: 'bonus', area: 'lon' },
  { slug: 'provision', label: 'Provision', description: 'provision', area: 'lon' },
  { slug: 'vite', label: 'Vite', description: 'avtalat vite', area: 'skadestand' },
  { slug: 'skadestand', label: 'Skadestånd', description: 'skadestånd', area: 'skadestand' },
  { slug: 'ranta', label: 'Ränta', description: 'ränta', area: 'skadestand' },
  { slug: 'forlikning', label: 'Förlikning', description: 'förlikning', area: 'skadestand' },
  { slug: 'preskription', label: 'Preskription', description: 'preskription', area: 'skadestand' },
  { slug: 'bevisborda', label: 'Bevisbörda', description: 'bevisbörda', area: 'skadestand' },
];

const CHUNK = {
  text: 'Arbetstagaren har rätt till lön och bonus.',
  context: 'Lag (1982:80) om anställningsskydd › 7 §',
  source: 'SFS 1982:80 7 §',
};

const USAGE = { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 1000, cacheReadTokens: 0 };

/** A fake client that answers the tagger's calls with `answers` in turn. */
function answering(...answers: string[][]) {
  let call = 0;
  const client = createFakeLlmClient(() => ({
    tags: answers[Math.min(call++, answers.length - 1)],
  }));
  return {
    ...client,
    complete: async (request: Parameters<typeof client.complete>[0]) => ({
      ...(await client.complete(request)),
      usage: USAGE,
    }),
  };
}

describe('LLM-backed roles', () => {
  describe('tagger', () => {
    it('sends the vocabulary grouped by area as a cached system prompt and the chunk as prompt', async () => {
      const client = answering(['lon', 'bonus', 'provision']);

      await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      const [request] = client.requests;
      expect(request.cacheSystem).toBe(true);
      expect(request.system).toContain('Välj 3–8 taggar');
      expect(request.system).toContain('## lon\n- lon: Lön – lön och lönevillkor\n- bonus: Bonus');
      expect(request.system).toContain('## skadestand\n- vite: Vite – avtalat vite');
      expect(request.prompt).toBe(
        'Källa: SFS 1982:80 7 §\nSammanhang: Lag (1982:80) om anställningsskydd › 7 §\n' +
          'Text:\nArbetstagaren har rätt till lön och bonus.',
      );
    });

    it('discards unknown slugs and stores duplicates once', async () => {
      const client = answering(['lon', 'made-up', 'bonus', 'lon', 'provision', 'made-up', 'other']);

      const result = await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      expect(result).toEqual({
        tags: ['lon', 'bonus', 'provision'],
        discarded: ['made-up', 'other'],
        overLimit: [],
        retried: false,
        usage: USAGE,
      });
      expect(client.requests).toHaveLength(1);
    });

    it('asks once more, naming the invalid slugs, when fewer than 3 known tags come back', async () => {
      const client = answering(['lon', 'made-up', 'lon'], ['lon', 'bonus', 'vite']);

      const result = await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      expect(client.requests).toHaveLength(2);
      expect(client.requests[1].prompt).toContain(
        'Ditt förra svar gav 1 giltiga taggar. Dessa slugs finns inte i vokabulären: made-up.',
      );
      expect(client.requests[1].prompt).toContain(
        'Text:\nArbetstagaren har rätt till lön och bonus.',
      );
      expect(result).toMatchObject({
        tags: ['lon', 'bonus', 'vite'],
        discarded: ['made-up'],
        retried: true,
      });
      expect(result.usage).toEqual({
        inputTokens: 20,
        outputTokens: 10,
        cacheWriteTokens: 2000,
        cacheReadTokens: 0,
      });
    });

    it('accepts fewer than 3 tags after the one retry', async () => {
      const client = answering(['lon'], ['bonus']);

      const result = await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      expect(client.requests).toHaveLength(2);
      expect(client.requests[1].prompt).toContain('Det var för få taggar.');
      expect(result).toMatchObject({ tags: ['bonus', 'lon'], retried: true });
    });

    it("uses the retry's answer when it has enough tags, without counting the first as cut", async () => {
      const retryAnswer = [
        'vite',
        'skadestand',
        'ranta',
        'forlikning',
        'preskription',
        'bevisborda',
      ];
      const client = answering(['lon', 'bonus'], retryAnswer);

      const result = await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      expect(result).toMatchObject({ tags: retryAnswer, overLimit: [], retried: true });
    });

    it('matches slugs regardless of case and surrounding whitespace', async () => {
      const client = answering([' Lon', 'BONUS ', 'vite']);

      const result = await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      expect(result).toMatchObject({ tags: ['lon', 'bonus', 'vite'], discarded: [] });
      expect(client.requests).toHaveLength(1);
    });

    it('carries the tokens of the calls made so far when the retry fails', async () => {
      let call = 0;
      const client = {
        requests: [] as unknown[],
        async complete() {
          call += 1;
          if (call === 2) throw new LlmError('Anthropic API returned 529', { retryable: true });
          return { data: { tags: ['lon'] }, usage: USAGE };
        },
      };

      const failure = await createLlmTagger(client)
        .tag(CHUNK, VOCABULARY)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(LlmError);
      expect(failure).toMatchObject({ message: 'Anthropic API returned 529', usage: USAGE });
    });

    it("keeps the first 8 known tags in the model's order", async () => {
      const slugs = VOCABULARY.map((tag) => tag.slug).reverse();
      const client = answering(slugs);

      const result = await createLlmTagger(client).tag(CHUNK, VOCABULARY);

      expect(result.tags).toEqual(slugs.slice(0, 8));
      expect(result.overLimit).toEqual([slugs[8]]);
      expect(client.requests).toHaveLength(1);
    });
  });

  describe('query translator', () => {
    it('sends the instruction with the vocabulary as a cached Swedish system prompt', async () => {
      const client = createFakeLlmClient(() => ({ tags: [] }));

      await createLlmQueryTranslator(client).translate(
        'Anställningsavtal för en säljare',
        VOCABULARY,
      );

      const [request] = client.requests;
      expect(request).toMatchObject({
        prompt: 'Uppdrag:\nAnställningsavtal för en säljare',
        cacheSystem: true,
      });
      expect(request.system).toContain('Välj högst 8 taggar');
      expect(request.system).toContain('- vite: Vite – avtalat vite');
    });

    it('drops unknown and repeated slugs and keeps the rest in the model order', async () => {
      const client = createFakeLlmClient(() => ({ tags: ['vite', 'other', 'LON', 'vite', 'lon'] }));

      await expect(
        createLlmQueryTranslator(client).translate('Vite och lön', VOCABULARY),
      ).resolves.toEqual({ tags: [{ slug: 'vite' }, { slug: 'lon' }], usage: NO_USAGE });
    });

    it('keeps at most 8 tags', async () => {
      const client = createFakeLlmClient(() => ({ tags: VOCABULARY.map((tag) => tag.slug) }));

      const { tags } = await createLlmQueryTranslator(client).translate('Allt', VOCABULARY);

      expect(tags.map((tag) => tag.slug)).toEqual(VOCABULARY.slice(0, 8).map((tag) => tag.slug));
    });

    it('returns no tags when the model picks none', async () => {
      const client = createFakeLlmClient(() => ({ tags: [] }));

      await expect(
        createLlmQueryTranslator(client).translate('Väder', VOCABULARY),
      ).resolves.toMatchObject({ tags: [] });
    });
  });

  describe('judge', () => {
    const CHUNK = {
      id: 'c1',
      text: 'Konkurrensklausulen gäller i ett år.',
      source: 'AD 2019 nr 35',
    };

    it('asks the JEV question about the source and text in Swedish', async () => {
      const client = createFakeLlmClient(() => ({ score: 0.8 }));

      await createLlmJudge(client).judge(' Anställningsavtal med konkurrensklausul ', CHUNK);

      const [request] = client.requests;
      expect(request.system).toContain('svensk lagstiftning eller rättspraxis');
      expect(request.prompt).toBe(
        'Är texten relevant för följande uppdrag: Anställningsavtal med konkurrensklausul?\n\n' +
          'Text:\nAD 2019 nr 35\n\nKonkurrensklausulen gäller i ett år.',
      );
      expect(request.schema).toMatchObject({ required: ['score'] });
    });

    it('returns the score clamped to 0–1 with the tokens used', async () => {
      const client = createFakeLlmClient(() => ({ score: 1.4 }));

      await expect(createLlmJudge(client).judge('x', CHUNK)).resolves.toEqual({
        score: 1,
        judgedBy: 'llm',
        usage: NO_USAGE,
      });
    });
  });

  it('generator drafts from the rendered template and returns the text and usage', async () => {
    const client = createFakeLlmClient(() => ({ text: 'Utkast [K:c1]' }));
    const template = loadPromptTemplate('nda');

    const draft = await createLlmGenerator(client).generate({
      template: 'nda',
      instruction: 'Tvåårigt sekretessavtal',
      chunks: [
        { id: 'c1', text: 'Confidentiality…', source: 'SFS 2018:558 2 §' },
        { id: 'c2', text: 'Damages…' },
      ],
      parties: 'A och B',
    });

    expect(draft).toEqual({ text: 'Utkast [K:c1]', usage: NO_USAGE });
    const [request] = client.requests;
    expect(request.system).toContain(template.disclaimer);
    expect(request.prompt).toContain('Tvåårigt sekretessavtal');
    expect(request.prompt).toContain('A och B');
    expect(request.prompt).toContain(
      '[K:c1] SFS 2018:558 2 §\nConfidentiality…\n\n[K:c2]\nDamages…',
    );
    expect(request.schema).toMatchObject({ required: ['text'] });
  });

  it('generator rejects an unknown template before calling the model', async () => {
    const client = createFakeLlmClient(() => ({ text: 'x' }));

    await expect(
      createLlmGenerator(client).generate({
        template: 'lease',
        instruction: 'x',
        chunks: [{ id: 'c1', text: 'y' }],
      }),
    ).rejects.toThrow('Unknown template "lease"');
    expect(client.requests).toHaveLength(0);
  });

  it('rejects a response that does not match the expected shape', async () => {
    const client = createFakeLlmClient(() => ({ score: 'high' }));

    await expect(createLlmJudge(client).judge('x', { id: 'c1', text: 'y' })).rejects.toThrow(
      'LLM response does not match the schema',
    );
  });
});
