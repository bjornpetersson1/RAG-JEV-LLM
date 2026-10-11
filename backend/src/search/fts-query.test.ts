import { describe, expect, it } from 'vitest';
import { buildFtsQuery } from './fts-query.js';

describe('buildFtsQuery', () => {
  it('ORs the distinct words of the instruction and the tag labels as prefix terms', () => {
    expect(buildFtsQuery('Lön och semester', ['Semester', 'Lön'])).toBe('"lön"* OR "semes"*');
  });

  it('cuts long words by up to three letters, keeping at least five', () => {
    expect(buildFtsQuery('uppsägningen uppsägning anställd vite', [])).toBe(
      '"uppsägnin"* OR "uppsägn"* OR "anstä"* OR "vite"*',
    );
  });

  it('drops stop words and punctuation and keeps å, ä and ö', () => {
    expect(buildFtsQuery('Skriv ett avtal för en säljare, med sekretess!', [])).toBe(
      '"skriv"* OR "avtal"* OR "sälja"* OR "sekret"*',
    );
  });

  it('leaves out words shorter than three characters and matches numbers exactly', () => {
    expect(buildFtsQuery('NDA för ett AB enligt 7 § i lag 1982:80', [])).toBe(
      '"nda"* OR "enlig"* OR "lag"* OR "1982"',
    );
  });

  it('reads a decomposed å, ä or ö as part of its word', () => {
    expect(buildFtsQuery('lo\u0308n', [])).toBe('"lön"*');
  });

  it('gives no query when no word is left', () => {
    expect(buildFtsQuery('och, att – för!', [])).toBeNull();
    expect(buildFtsQuery('', [])).toBeNull();
  });
});
