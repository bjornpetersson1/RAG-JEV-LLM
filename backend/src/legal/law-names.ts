// The imported laws' common names and abbreviations, shared by the post-check (E6-3) and the
// embedder (E8-2).

/**
 * Names and abbreviations of the imported laws a text may cite, by SFS number. Only these are
 * recognised; any other abbreviation is not read as a reference (see the E6-3 spec).
 */
export const LAW_ALIASES: Record<string, string> = {
  LAS: '1982:80',
  anställningsskyddslagen: '1982:80',
  AvtL: '1915:218',
  avtalslagen: '1915:218',
  FHL: '2018:558',
  företagshemlighetslagen: '2018:558',
  SemL: '1977:480',
  semesterlagen: '1977:480',
  DL: '2008:567',
  diskrimineringslagen: '2008:567',
  ATL: '1982:673',
  arbetstidslagen: '1982:673',
  MBL: '1976:580',
  medbestämmandelagen: '1976:580',
  FLL: '1995:584',
  föräldraledighetslagen: '1995:584',
};

/** Each aliased law's title, as the chunks' heading paths give it. */
const LAW_TITLES: Record<string, string> = {
  '1982:80': 'Lag (1982:80) om anställningsskydd',
  '1915:218': 'Lag (1915:218) om avtal och andra rättshandlingar på förmögenhetsrättens område',
  '2018:558': 'Lag (2018:558) om företagshemligheter',
  '1977:480': 'Semesterlag (1977:480)',
  '2008:567': 'Diskrimineringslag (2008:567)',
  '1982:673': 'Arbetstidslag (1982:673)',
  '1976:580': 'Lag (1976:580) om medbestämmande i arbetslivet',
  '1995:584': 'Föräldraledighetslag (1995:584)',
};

for (const sfs of new Set(Object.values(LAW_ALIASES))) {
  if (!LAW_TITLES[sfs]) throw new Error(`LAW_TITLES has no title for SFS ${sfs} in LAW_ALIASES`);
}

// The abbreviations only (they start with a capital): the full names already say which law it is.
// A genitive (`LAS:s`) is kept with the abbreviation. Case-sensitive, since lower-case `dl` or `las`
// are ordinary words. One already followed by a parenthesis (e.g. its title) is left alone.
const ABBREVIATION = new RegExp(
  `(?<!\\p{L})(${Object.keys(LAW_ALIASES)
    .filter((alias) => /^\p{Lu}/u.test(alias))
    .join('|')})(?!(?::?s)? ?\\()(?::?s)?(?!\\p{L})`,
  'gu',
);

/**
 * `text` with each law abbreviation (`LAS`, also `LAS:s`) replaced by `replace(written, sfs)`,
 * where `written` is the abbreviation as written and `sfs` the law's SFS number, e.g. `1982:80`.
 */
export function replaceLawAbbreviations(
  text: string,
  replace: (written: string, sfs: string) => string,
): string {
  return text.replace(ABBREVIATION, (written, abbreviation: string) =>
    replace(written, LAW_ALIASES[abbreviation]),
  );
}

/**
 * `text` with each law abbreviation followed by the law's title, e.g. "7 § LAS" → "7 § LAS
 * (Lag (1982:80) om anställningsskydd)". An embedding model does not know the abbreviations, but
 * the chunks it is compared with carry the title in their heading path.
 */
export function spellOutLawAbbreviations(text: string): string {
  return replaceLawAbbreviations(text, (written, sfs) => `${written} (${LAW_TITLES[sfs]})`);
}
