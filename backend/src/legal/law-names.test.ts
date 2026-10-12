import { describe, expect, it } from 'vitest';
import { replaceLawAbbreviations, spellOutLawAbbreviations } from './law-names.js';

describe('spellOutLawAbbreviations', () => {
  it.each([
    ['7 § LAS', '7 § LAS (Lag (1982:80) om anställningsskydd)'],
    [
      '2 kap. 9 § DL och 33 § AvtL',
      '2 kap. 9 § DL (Diskrimineringslag (2008:567)) och 33 § AvtL (Lag (1915:218) om avtal och andra rättshandlingar på förmögenhetsrättens område)',
    ],
    ['enligt LAS:s regler', 'enligt LAS:s (Lag (1982:80) om anställningsskydd) regler'],
  ])('spells out %s', (text, expected) => {
    expect(spellOutLawAbbreviations(text)).toBe(expected);
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
    expect(spellOutLawAbbreviations(text)).toBe(text);
  });
});

describe('replaceLawAbbreviations', () => {
  it('passes each abbreviation as written and its SFS number', () => {
    expect(replaceLawAbbreviations('7 § LAS och MBL:s regler', (_written, sfs) => sfs)).toBe(
      '7 § 1982:80 och 1976:580 regler',
    );
  });
});
