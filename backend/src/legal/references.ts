// Statute, provision and case references in Swedish legal text (E6-3), and whether a chunk's source
// reference is what one cites. Shared by the post-check and hybrid retrieval (E8-4).

import { LAW_ALIASES } from './law-names.js';

/** A statute, provision or case: the document identifier and, for a provision, its place. */
export interface LegalReference {
  /** E.g. `SFS 1982:80`, `AD 2019 nr 35` or `NJA 2015 s. 123`. */
  document: string;
  chapter?: string;
  /** E.g. `7` or `33d`, without spaces. */
  section?: string;
}

interface FoundReference extends LegalReference {
  start: number;
  end: number;
}

const ALIASES = [
  ...new Set(Object.keys(LAW_ALIASES).flatMap((alias) => [alias, capitalised(alias)])),
]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');
// A known name or abbreviation as a whole word, also in the genitive (`semesterlagens`, `LAS:s`).
const ALIAS = `(?<!\\p{L})(?<alias>${ALIASES})(?::?s)?(?!\\p{L})`;
// A law: `SFS 1982:80`, `lagen (1982:80)` / `Lag (1982:80)`, or a known name or abbreviation.
const LAW = `(?:SFS\\s+(?<sfs>\\d{4}:\\d+)|[Ll]ag(?:en)?\\s*\\((?<lagen>\\d{4}:\\d+)\\)|${ALIAS})`;
const ORDINAL = '(?:första|andra|tredje|fjärde|femte|sjätte)';
// `st. 2`, `2 st.`, `första stycket`, `första och andra stycket`.
const PARAGRAPH = `(?:\\s*(?:st\\.\\s*\\d+|\\d+\\s*st\\.|${ORDINAL}(?:\\s*(?:,|och)\\s*${ORDINAL})*\\s+stycket))?`;
const SECTION = '\\d+(?:\\s?[a-z](?!\\p{L}))?';
// One or more sections of one law: `7 § LAS`, `2 kap. 9 § DL`, `7 och 8 §§ LAS`, `8 § (1982:80)`.
const PROVISION_PATTERN = new RegExp(
  `(?<!\\d)(?:(?<chapter>\\d+)\\s*kap\\.\\s*)?(?<sections>${SECTION}(?:\\s*(?:,|och)\\s*${SECTION})*)\\s*§§?${PARAGRAPH}\\s+(?:${LAW}|\\((?<paren>\\d{4}:\\d+)\\))`,
  'gu',
);
const LAW_PATTERN = new RegExp(LAW, 'gu');
// Models also write `NJA 2015 s 123` without the dot.
const CASE_PATTERN = /\b(?<court>AD|NJA)\s+(?<year>\d{4})\s+(?<kind>nr|s\.?)\s*(?<number>\d+)\b/gu;
// A `§` just before a law name means a provision written in a form the pattern does not read
// (e.g. `7 § i LAS`); the name is then not a whole-statute reference, which would always pass.
const AFTER_SECTION_SIGN = /§(?:\s+\p{L}+)?\s*$/u;
// `lagen (1982:80) om anställningsskydd (LAS)` names one law once, not twice.
const SAME_LAW_DISTANCE = 80;

/** Provisions first; then statutes and cases outside them, so "7 § LAS" is one reference. */
export function findFreeTextReferences(text: string): FoundReference[] {
  const provisions = [...text.matchAll(PROVISION_PATTERN)].flatMap((match) => {
    const groups = match.groups ?? {};
    const document = lawDocument({ ...groups, sfs: groups.sfs ?? groups.paren });
    if (!document) return [];
    // `7 och 8 §§ LAS` is two references to one law, both at the same place in the text.
    return groups.sections.split(/\s*(?:,|och)\s*/).map((section) => ({
      ...span(match),
      document,
      chapter: groups.chapter,
      section: compact(section),
    }));
  });
  const inProvision = (start: number) =>
    provisions.some((provision) => start >= provision.start && start < provision.end);

  const statutes: FoundReference[] = [];
  for (const match of text.matchAll(LAW_PATTERN)) {
    const document = lawDocument(match.groups);
    if (!document || inProvision(match.index)) continue;
    if (match.groups?.alias && isAfterSectionSign(text, match.index)) continue;
    const previous = statutes.at(-1);
    const repeatsPrevious =
      previous?.document === document &&
      text.charAt(match.index - 1) === '(' &&
      match.index - previous.end <= SAME_LAW_DISTANCE;
    if (!repeatsPrevious) statutes.push({ ...span(match), document });
  }

  const cases = [...text.matchAll(CASE_PATTERN)].map((match) => {
    const { court, year, kind, number } = match.groups ?? {};
    return {
      ...span(match),
      document: `${court} ${year} ${kind === 'nr' ? 'nr' : 's.'} ${number}`,
    };
  });
  return [...provisions, ...statutes, ...cases].sort((a, b) => a.start - b.start);
}

function isAfterSectionSign(text: string, start: number): boolean {
  return AFTER_SECTION_SIGN.test(text.slice(Math.max(0, start - 30), start));
}

/** The document, chapter and section of a chunk's source reference, e.g. `SFS 1982:80 7 § st. 2`. */
export function parseSource(source: string): LegalReference {
  const match =
    /^(?<document>SFS \d{4}:\d+|AD \d{4} nr \d+|NJA \d{4} s\. \d+)(?: (?:(?<chapter>\d+) kap\. )?(?<section>\d+(?: ?[a-z])?) §)?/u.exec(
      source,
    );
  if (!match?.groups) return { document: source };
  const { document, chapter, section } = match.groups;
  return { document, chapter, section: section === undefined ? undefined : compact(section) };
}

/** Whether a chunk with source reference `source` is what `reference` cites. */
export function citesSource(reference: LegalReference, source: string): boolean {
  return matches(reference, parseSource(source));
}

/**
 * A reference matches a source from the same document; one naming a section must match its section,
 * and its chapter too when it names one (a section without a chapter matches it in any chapter).
 */
export function matches(reference: LegalReference, source: LegalReference): boolean {
  if (reference.document !== source.document) return false;
  if (reference.section === undefined) return true;
  if (reference.section !== source.section) return false;
  return reference.chapter === undefined || reference.chapter === source.chapter;
}

function lawDocument(groups: Record<string, string | undefined> | undefined): string | undefined {
  const sfs = groups?.sfs ?? groups?.lagen ?? aliasSfs(groups?.alias);
  return sfs === undefined ? undefined : `SFS ${sfs}`;
}

function aliasSfs(alias: string | undefined): string | undefined {
  if (alias === undefined) return undefined;
  return LAW_ALIASES[alias] ?? LAW_ALIASES[alias.charAt(0).toLowerCase() + alias.slice(1)];
}

function span(match: RegExpExecArray): { start: number; end: number } {
  return { start: match.index, end: match.index + match[0].length };
}

function compact(section: string | undefined): string | undefined {
  return section?.replace(/\s+/g, '');
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
