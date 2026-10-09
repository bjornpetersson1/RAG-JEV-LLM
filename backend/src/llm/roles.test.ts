import { describe, expect, it } from 'vitest';
import { createFakeLlmClient } from './fakes.js';
import {
  createLlmGenerator,
  createLlmJudge,
  createLlmQueryTranslator,
  createLlmTagger,
} from './roles.js';

const VOCABULARY = [{ name: 'employment', description: 'Employment law' }, { name: 'termination' }];

describe('LLM-backed roles', () => {
  it('tagger sends the vocabulary and text and keeps only known, unique tags', async () => {
    const client = createFakeLlmClient(() => ({ tags: ['employment', 'made-up', 'employment'] }));

    const tags = await createLlmTagger(client).tag('An employee may be dismissed…', VOCABULARY);

    expect(tags).toEqual(['employment']);
    expect(client.requests[0].prompt).toContain('- employment: Employment law\n- termination');
    expect(client.requests[0].prompt).toContain('An employee may be dismissed…');
  });

  it('query translator keeps only known tags', async () => {
    const client = createFakeLlmClient(() => ({ tags: ['termination', 'other'] }));

    await expect(
      createLlmQueryTranslator(client).translate('Draft a termination clause', VOCABULARY),
    ).resolves.toEqual(['termination']);
  });

  it('judge returns the judgement with the score clamped to 0–1', async () => {
    const client = createFakeLlmClient(() => ({ relevant: true, score: 1.4 }));

    await expect(
      createLlmJudge(client).judge('non-compete', { id: 'c1', text: 'A non-compete clause…' }),
    ).resolves.toEqual({ relevant: true, score: 1 });
  });

  it('generator returns the draft with unique references to given chunks only', async () => {
    const client = createFakeLlmClient(() => ({ text: 'Draft', references: ['c1', 'c9', 'c1'] }));

    const draft = await createLlmGenerator(client).generate({
      template: 'NDA template',
      instruction: 'Two-year NDA',
      chunks: [
        { id: 'c1', text: 'Confidentiality…', source: 'SFS 2018:558 2 §' },
        { id: 'c2', text: 'Damages…' },
      ],
    });

    expect(draft).toEqual({ text: 'Draft', references: ['c1'] });
    expect(client.requests[0].prompt).toContain(
      '[c1] (SFS 2018:558 2 §) Confidentiality…\n\n[c2] Damages…',
    );
  });

  it('rejects a response that does not match the expected shape', async () => {
    const client = createFakeLlmClient(() => ({ relevant: 'yes', score: 0.2 }));

    await expect(createLlmJudge(client).judge('x', { id: 'c1', text: 'y' })).rejects.toThrow(
      'LLM response does not match the schema',
    );
  });
});
