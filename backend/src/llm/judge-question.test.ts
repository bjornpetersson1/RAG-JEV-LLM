import { describe, expect, it } from 'vitest';
import { judgedText, relevanceQuestion } from './judge-question.js';

describe('relevanceQuestion', () => {
  it.each([
    ['Sekretessavtal för en konsult', 'Sekretessavtal för en konsult'],
    ['  Skriv ett sekretessavtal för en konsult.  ', 'Skriv ett sekretessavtal för en konsult'],
    ['Behövs en konkurrensklausul?!', 'Behövs en konkurrensklausul'],
  ])('asks about %j ending in exactly one question mark', (instruction, task) => {
    expect(relevanceQuestion(instruction)).toBe(
      `Är texten relevant för följande uppdrag: ${task}?`,
    );
  });

  it('rejects an instruction with no words', () => {
    expect(() => relevanceQuestion(' ?. ')).toThrow('An instruction is required');
  });
});

describe('judgedText', () => {
  it('puts the source reference before the text, when there is one', () => {
    expect(judgedText({ id: 'c1', text: 'Text.', source: 'SFS 1982:80 7 §' })).toBe(
      'SFS 1982:80 7 §\n\nText.',
    );
    expect(judgedText({ id: 'c1', text: 'Text.' })).toBe('Text.');
  });
});
