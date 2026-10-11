import { describe, expect, it } from 'vitest';
import { NO_USAGE } from '../llm/client.js';
import { createFakeGenerator } from '../llm/fakes.js';
import type { Chunk, GenerateInput } from '../llm/types.js';
import { generateDraft } from './generate.js';
import { loadPromptTemplate } from './templates.js';

const CHUNKS: Chunk[] = [
  { id: '11', text: 'Saklig grund krävs.', source: 'SFS 1982:80 7 §' },
  { id: '12', text: 'Uppsägningstid en månad.', source: 'SFS 1982:80 11 §' },
  { id: '21', text: 'Konkurrensklausulen är oskälig.', source: 'AD 2015 nr 8, Domskäl' },
];

const DISCLAIMER = loadPromptTemplate('employment').disclaimer;

async function draftWith(text: string, maxChunks = 2) {
  const inputs: GenerateInput[] = [];
  const generator = createFakeGenerator((input) => {
    inputs.push(input);
    return text;
  });
  const result = await generateDraft(
    { template: 'employment', instruction: 'Säljare', chunks: CHUNKS },
    { generator, limits: { maxChunks, maxContextChars: 10_000 } },
  );
  return { result, inputs };
}

describe('generateDraft', () => {
  it('lists only submitted chunks as used sources and leaves the text as written', async () => {
    // 11 and 12 are submitted; 21 is approved but over the chunk limit; 99 is unknown.
    const text = `Saklig grund [K:11]. Klausul [K:21]. Påhittad [K:99]. Igen [K:11].\n\n${DISCLAIMER}`;

    const { result, inputs } = await draftWith(text);

    expect(inputs[0].chunks.map((c) => c.id)).toEqual(['11', '12']);
    expect(result.text).toBe(text);
    expect(result.used.map((c) => c.id)).toEqual(['11']);
    expect(result.used[0]).toEqual(CHUNKS[0]);
    expect(result.unused.map((c) => c.id)).toEqual(['12']);
    expect(result.leftOut.map((c) => c.id)).toEqual(['21']);
    expect(result.check?.flags.map(({ kind, text }) => [kind, text])).toEqual([
      ['citation', '[K:21]'],
      ['citation', '[K:99]'],
    ]);
    expect(result.check).toMatchObject({ references: 4, valid: 2, sourceAccuracy: 0.5 });
    expect(result.context).toEqual({
      limits: { maxChunks: 2, maxContextChars: 10_000 },
      limitedBy: ['maxChunks'],
      needed: { maxChunks: 3, maxContextChars: 74 },
    });
    expect(result.usage).toEqual(NO_USAGE);
  });

  it('lists used sources in order of first citation, groups included', async () => {
    const { result } = await draftWith(`Tid [K:12, K:11]. ${DISCLAIMER}`);

    expect(result.used.map((c) => c.id)).toEqual(['12', '11']);
    expect(result.unused).toEqual([]);
  });

  it('cites every submitted chunk with the default fake generator', async () => {
    const result = await generateDraft(
      { template: 'nda', instruction: 'NDA', chunks: CHUNKS },
      { generator: createFakeGenerator(), limits: { maxChunks: 20, maxContextChars: 60_000 } },
    );

    expect(result.used.map((c) => c.id)).toEqual(['11', '12', '21']);
    expect(result.check).toMatchObject({ flags: [], references: 3, valid: 3, sourceAccuracy: 1 });
    expect(result.context.limitedBy).toEqual([]);
  });

  it('appends the disclaimer line when the model left it out', async () => {
    const { result } = await draftWith('# Avtal\n\nText [K:11].\n');

    expect(result.text).toBe(`# Avtal\n\nText [K:11].\n\n${DISCLAIMER}`);
  });

  it('keeps a disclaimer the model wrote without its emphasis', async () => {
    const plain = DISCLAIMER.replace(/^_|_$/g, '');

    const { result } = await draftWith(`Text.\n\n${plain}`);

    expect(result.text).toBe(`Text.\n\n${plain}`);
  });

  it('appends the disclaimer when the model wrote it somewhere other than the end', async () => {
    const { result } = await draftWith(`# Avtal\n\n${DISCLAIMER}\n\n## Sekretess\n\nText [K:11].`);

    expect(result.text).toBe(
      `# Avtal\n\n${DISCLAIMER}\n\n## Sekretess\n\nText [K:11].\n\n${DISCLAIMER}`,
    );
  });

  it('does not call the generator when no approved chunk fits the character budget', async () => {
    let calls = 0;
    const result = await generateDraft(
      { template: 'nda', instruction: 'NDA', chunks: CHUNKS },
      {
        generator: createFakeGenerator(() => (calls++, 'x')),
        limits: { maxChunks: 20, maxContextChars: 5 },
      },
    );

    expect(calls).toBe(0);
    expect(result.text).toBeUndefined();
    expect(result.check).toBeUndefined();
    expect(result.used).toEqual([]);
    expect(result.leftOut).toEqual(CHUNKS);
    expect(result.context.limitedBy).toEqual(['maxContextChars']);
    expect(result.usage).toEqual(NO_USAGE);
  });

  it('passes the parties on to the generator', async () => {
    const inputs: GenerateInput[] = [];
    await generateDraft(
      { template: 'nda', instruction: 'NDA', chunks: CHUNKS, parties: 'A och B' },
      {
        generator: createFakeGenerator((input) => (inputs.push(input), 'x')),
        limits: { maxChunks: 1, maxContextChars: 100 },
      },
    );

    expect(inputs[0]).toMatchObject({ template: 'nda', instruction: 'NDA', parties: 'A och B' });
  });
});
