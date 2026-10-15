import { describe, expect, it, vi } from 'vitest';
import { createSystemOneClient } from '../systemone/client.js';
import { createFakeLlmClient } from '../llm/fakes.js';
import { createLlmQueryTranslator } from '../llm/roles.js';
import { createCapturingLogger } from '../llm/test-helpers.js';
import type { QueryTranslator } from '../llm/types.js';
import { createSystemOneQueryTranslator } from './systemone-translator.js';
import { createFakeJev, VOCABULARY } from './test-helpers.js';
import { translateQuery } from './translate-query.js';

const PRESETS = {
  employment: ['lon', 'semesterdagar'],
  nda: ['sekretessklausul', 'foretagshemlighet'],
};

/** Both implementations, each answering "vite" and "lon" for any instruction. */
function implementations(): [string, QueryTranslator, () => number][] {
  const llmClient = createFakeLlmClient(() => ({ tags: ['vite', 'lon', 'okand'] }));
  const jev = createFakeJev({ lon: 0.6, skadestand: 0.4 }, { vite: 0.8, lon: 0.7 });
  const jevClient = createSystemOneClient({
    provider: 'jev',
    apiKey: 'k',
    baseUrl: 'https://jev.example/v1',
    model: 'jev-latest',
    timeoutMs: 1000,
    role: 'queryTranslator',
    logger: createCapturingLogger(),
    fetch: jev.fetch,
  });
  return [
    ['llm', createLlmQueryTranslator(llmClient), () => llmClient.requests.length],
    ['jev', createSystemOneQueryTranslator(jevClient, 0.5), () => jev.requests.length],
  ];
}

describe.each(implementations())(
  'translateQuery with the %s translator',
  (_name, translator, calls) => {
    const context = { translator, vocabulary: VOCABULARY, presets: PRESETS };
    const known = new Set(VOCABULARY.map((tag) => tag.slug));

    it('gives only vocabulary slugs for free text, marked translated', async () => {
      const result = await translateQuery({ instruction: 'Avtal med vite och lön' }, context);

      expect(result.tags.map(({ slug, origin }) => ({ slug, origin }))).toEqual([
        { slug: 'vite', origin: 'translated' },
        { slug: 'lon', origin: 'translated' },
      ]);
      expect(result.tags.every((tag) => known.has(tag.slug))).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('gives a template alone its presets without calling the translator', async () => {
      const before = calls();

      const result = await translateQuery({ instruction: '  ', template: 'nda' }, context);

      expect(result.tags).toEqual([
        { slug: 'sekretessklausul', origin: 'preset' },
        { slug: 'foretagshemlighet', origin: 'preset' },
      ]);
      expect(calls()).toBe(before);
    });

    it('merges a template with free text: presets first, then translated tags not among them', async () => {
      const result = await translateQuery(
        { instruction: 'Med vite', template: 'employment' },
        context,
      );

      expect(result.tags.map(({ slug, origin }) => ({ slug, origin }))).toEqual([
        { slug: 'lon', origin: 'preset' },
        { slug: 'semesterdagar', origin: 'preset' },
        { slug: 'vite', origin: 'translated' },
      ]);
    });

    it('rejects an unknown template', async () => {
      await expect(
        translateQuery({ instruction: 'x', template: 'lease' }, context),
      ).rejects.toThrow('Unknown template "lease": expected employment or nda');
    });
  },
);

describe('translateQuery', () => {
  it("passes on the translator's token usage", async () => {
    const [[, translator]] = implementations();

    const result = await translateQuery(
      { instruction: 'Vite' },
      { translator, vocabulary: VOCABULARY, presets: PRESETS },
    );

    expect(result.usage).toBeDefined();
  });

  it('passes on the JEV scores for the UI', async () => {
    const [, [, translator]] = implementations();

    const result = await translateQuery(
      { instruction: 'Vite' },
      { translator, vocabulary: VOCABULARY, presets: PRESETS },
    );

    expect(result.tags[0]).toEqual({ slug: 'vite', score: 0.8, origin: 'translated' });
    expect(result.areaScores).toEqual({ lon: 0.6, skadestand: 0.4 });
    expect(result.askedTags).toHaveLength(6);
  });

  it('times the translation', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const slow: QueryTranslator = {
        translate: async () => {
          vi.advanceTimersByTime(120);
          return { tags: [] };
        },
      };
      const result = await translateQuery(
        { instruction: 'x' },
        { translator: slow, vocabulary: VOCABULARY, presets: PRESETS },
      );
      expect(result.elapsedMs).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });
});
