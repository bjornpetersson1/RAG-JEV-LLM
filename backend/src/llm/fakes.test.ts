import { describe, expect, it } from 'vitest';
import { NO_USAGE } from './client.js';
import {
  createFakeGenerator,
  createFakeJudge,
  createFakeQueryTranslator,
  createFakeTagger,
} from './fakes.js';

const VOCABULARY = [
  { slug: 'anstallning', label: 'Employment' },
  { slug: 'konkurrensklausul', label: 'Non-compete' },
  { slug: 'uppsagning', label: 'Termination' },
].map((tag) => ({ ...tag, description: tag.label, area: 'anstallning' }));

describe('fake roles', () => {
  it('tagger and query translator pick the vocabulary tags whose label is in the text', async () => {
    const text = 'Employment contract with a NON-COMPETE clause';

    await expect(createFakeTagger().tag({ text }, VOCABULARY)).resolves.toEqual({
      tags: ['anstallning', 'konkurrensklausul'],
      discarded: [],
      overLimit: [],
      retried: false,
      usage: NO_USAGE,
    });
    await expect(createFakeQueryTranslator().translate(text, VOCABULARY)).resolves.toEqual({
      tags: [{ slug: 'anstallning' }, { slug: 'konkurrensklausul' }],
    });
  });

  it('judge scores the share of instruction keywords found in the chunk', async () => {
    const judge = createFakeJudge();

    await expect(
      judge.judge('notice period termination', { id: 'c1', text: 'The notice period is…' }),
    ).resolves.toEqual({ score: 2 / 3, judgedBy: 'llm', usage: NO_USAGE });
    await expect(judge.judge('notice period', { id: 'c2', text: 'Unrelated' })).resolves.toEqual({
      score: 0,
      judgedBy: 'llm',
      usage: NO_USAGE,
    });
  });

  it('judge keeps Swedish words with å, ä and ö whole', async () => {
    await expect(
      createFakeJudge().judge('uppsägningstid ändring', {
        id: 'c1',
        text: 'Uppsägningstiden är en månad.',
      }),
    ).resolves.toMatchObject({ score: 0.5 });
  });

  it('generator echoes its input and cites every chunk', async () => {
    const draft = await createFakeGenerator().generate({
      template: 'T',
      instruction: 'I',
      chunks: [
        { id: 'a', text: 'first' },
        { id: 'b', text: 'second' },
      ],
    });

    expect(draft).toEqual({ text: 'T\n\nI\n\n[a] first\n[b] second', references: ['a', 'b'] });
  });

  it('every fake accepts a configured answer', async () => {
    const chunk = { id: 'c', text: 't' };
    const draft = { text: 'fixed', references: [] };

    await expect(
      createFakeTagger(() => ['x']).tag({ text: 't' }, VOCABULARY),
    ).resolves.toMatchObject({ tags: ['x'] });
    await expect(
      createFakeQueryTranslator(() => ['y']).translate('t', VOCABULARY),
    ).resolves.toEqual({ tags: [{ slug: 'y' }] });
    await expect(
      createFakeJudge(() => ({ score: 0.1, judgedBy: 'jev' })).judge('t', chunk),
    ).resolves.toEqual({ score: 0.1, judgedBy: 'jev', usage: NO_USAGE });
    await expect(
      createFakeJudge(() => ({ score: 0.1, usage: undefined })).judge('t', chunk),
    ).resolves.toEqual({ score: 0.1, judgedBy: 'llm', usage: NO_USAGE });
    await expect(
      createFakeGenerator(() => draft).generate({ template: '', instruction: '', chunks: [] }),
    ).resolves.toEqual(draft);
  });
});
