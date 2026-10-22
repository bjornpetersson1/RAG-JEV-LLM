import { describe, expect, it } from 'vitest';
import { replaceLawAbbreviations } from './law-names.js';

describe('replaceLawAbbreviations', () => {
  it('passes each abbreviation as written and its SFS number', () => {
    expect(replaceLawAbbreviations('7 § LAS och MBL:s regler', (_written, sfs) => sfs)).toBe(
      '7 § 1982:80 och 1976:580 regler',
    );
  });

  it.each([
    'Uppsägning ska vara sakligt grundad',
    'anställningsskyddslagen gäller',
    'KLASSIFICERING av uppgifter',
    'DLL och LASER',
    'dl och las',
    '7 § LAS (Lag (1982:80) om anställningsskydd)',
    'LAS:s (Lag (1982:80) om anställningsskydd) regler',
  ])('leaves %s unchanged', (text) => {
    expect(replaceLawAbbreviations(text, () => 'X')).toBe(text);
  });
});
