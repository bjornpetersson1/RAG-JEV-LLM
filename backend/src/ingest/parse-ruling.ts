import { collapseWhitespace } from '../text.js';
import { decodeHtmlEntities } from './html.js';
import type { RulingSection, RulingSectionRole, RulingStructure } from './structure.js';

export interface ParsedRuling {
  /** The reference number, e.g. `AD 2024 nr 13` or `NJA 2015 s. 741`. */
  identifier: string;
  court: string;
  /** Decision date, ISO `YYYY-MM-DD`. */
  date: string;
  title: string;
  /** The imported part as kept in the tree: headings and paragraphs separated by blank lines. */
  text: string;
  structure: RulingStructure;
  /** Reasons to flag the ruling, e.g. that no sections were recognised. */
  warnings: string[];
}

export class RulingParseError extends Error {}

/** The fallback section for a ruling whose sections cannot be recognised. */
export const WHOLE_RULING_HEADING = 'Domen';
const OPENING_HEADING = 'Inledning';

const COURTS: Record<string, string> = { ADO: 'AD', HDO: 'HD' };
const MAX_TITLE_LENGTH = 200;
const MAX_HEADING_LENGTH = 80;
const ABBREVIATION_END = /(?:^|\s)(?:\p{L}{1,3}\.){2,}$/u;

const PARAGRAPH = /<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
// AD appends the district court's judgment after a paragraph "BILAGA".
const ATTACHMENT = /^bilaga(?: \d+)?$/i;
// NJA prints the lower courts, the parties' appeal and the reporting clerk's proposal before HD's
// own decision, which opens with "HD (justitieråden …) meddelade följande dom".
const HD_DECISION = /^HD \(/;
// Old NJA reports start a section inside a paragraph: "HD (JustR:n …) beslöt följande dom: Domskäl. …".
const INLINE_HEADING = /^(?:(.*?:)\s+)?(Domskäl|Domslut|Skäl|HD:s avgörande)\.\s+(.+)$/;
const FOOTER =
  /^(?:(?:Dom|Beslut) \d{4}-\d{2}-\d{2}, målnummer|(?:Rätts)?[Ss]ekreterare:|Ledamöter:|HD:s (?:dom|beslut) meddela|Mål nr:|Lagrum:|Rättsfall:)/;

const REASONS = /^(?:dom)?skäl$/i;
const RULING =
  /^(?:domslut|beslut|hd:s domslut|hd:s avgörande|arbetsdomstolens (?:ställningstagande|beslut|avgörande))$/i;
// Main sections that only open before the court's reasons; after them the same words are sub-sections.
const PROCEEDINGS =
  /^(?:bakgrund|yrkanden|parternas|grunder|utveckling av talan|utredning|bevisning|överklagad)/i;
// A paragraph that opens a judge's dissent or addition names the judge first.
const JUDGE =
  /^(?:referenten, )?(?:ledamoten|ledamöterna|justr(?::n)?|justitierådet|justitieråden) /i;
const DISSENT = /skiljaktig/i;
const ADDITION = /\btillade\b/i;
// A line that introduces a list ("Förbundet har yrkat att Arbetsdomstolen ska") is followed by an
// item or by its continuation in lower case; a heading is not.
const CONTINUATION = /^(?:\(\d+\)|[a-zåäö]\)|\d+[.)]|[-–•\u00ad]|\p{Ll})/u;
// A heading the source splits over two paragraphs breaks after a word like these.
const OPEN_ENDED_HEADING = /\s(?:och|eller|samt|hos|i|av|om|för|till|med|på|att|som|mot|vid|från)$/;

interface CaseLawRecord {
  domstol?: { domstolKod?: unknown };
  avgorandedatum?: unknown;
  referatNummerLista?: unknown;
  malNummerLista?: unknown;
  benamning?: unknown;
  sammanfattning?: unknown;
  innehall?: unknown;
}

/** Parses a case-law API record into its fields and the section tree of the deciding court's part. */
export function parseRulingRecord(json: string): ParsedRuling {
  const record = parseRecord(json);
  const courtCode = String(record.domstol?.domstolKod);
  const court = COURTS[courtCode];
  if (!court) throw new RulingParseError(`Unsupported court ${courtCode}`);
  const references = strings(record.referatNummerLista);
  const identifier =
    references.find((reference) => /^NJA \d{4} s\. \d+$/.test(reference)) ?? references[0];
  if (!identifier) throw new RulingParseError('No reference number');
  const date = typeof record.avgorandedatum === 'string' ? record.avgorandedatum : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RulingParseError('No decision date');
  if (typeof record.innehall !== 'string' || record.innehall.trim() === '') {
    throw new RulingParseError('No HTML full text (innehall)');
  }

  const warnings: string[] = [];
  const lines = ownPart(court, extractParagraphs(record.innehall), warnings)
    .filter((line) => !FOOTER.test(line))
    .flatMap(splitInlineHeading);
  let sections = buildSections(lines);
  if (lines.length === 0) throw new RulingParseError('No paragraphs in the full text');
  if (!sections.some((section) => section.role === 'reasons' || section.role === 'ruling')) {
    warnings.push('No Domskäl or Domslut heading found; imported as one section');
    sections = [
      { heading: WHOLE_RULING_HEADING, role: 'whole', paragraphs: lines, subsections: [] },
    ];
  }

  const summary = typeof record.sammanfattning === 'string' ? record.sammanfattning.trim() : '';
  return {
    identifier,
    court,
    date,
    title: titleOf(record.benamning, summary, identifier),
    text: renderText(sections),
    structure: {
      kind: 'ruling',
      court,
      references,
      caseNumbers: strings(record.malNummerLista),
      summary: summary || null,
      sections,
    },
    warnings,
  };
}

function parseRecord(json: string): CaseLawRecord {
  let record: unknown;
  try {
    record = JSON.parse(json);
  } catch {
    throw new RulingParseError('The raw file is not JSON');
  }
  if (typeof record !== 'object' || record === null) {
    throw new RulingParseError('The raw file is not a JSON object');
  }
  return record as CaseLawRecord;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** The text of every paragraph and heading element, with tags removed and whitespace collapsed. */
function extractParagraphs(html: string): string[] {
  return [...html.matchAll(PARAGRAPH)]
    .map(([, , content = '']) =>
      collapseWhitespace(decodeHtmlEntities(content.replace(/<[^>]*>/g, ' '))),
    )
    .filter((paragraph) => /[\p{L}\p{N}]/u.test(paragraph));
}

/** Cuts the text down to the deciding court's own part, so every chunk cites that court. */
function ownPart(court: string, paragraphs: string[], warnings: string[]): string[] {
  if (court === 'AD') {
    const attachment = paragraphs.findIndex((paragraph) => ATTACHMENT.test(paragraph));
    return attachment === -1 ? paragraphs : paragraphs.slice(0, attachment);
  }
  const start = paragraphs.findIndex((paragraph) => HD_DECISION.test(paragraph));
  if (start === -1) {
    warnings.push("No start of HD's decision found; the whole text is used");
    return paragraphs;
  }
  return paragraphs.slice(start);
}

/** "Domskäl. När …" becomes the heading "Domskäl" and the paragraph "När …". */
function splitInlineHeading(line: string): string[] {
  const match = line.match(INLINE_HEADING);
  if (!match) return [line];
  const [, intro, heading = '', rest = ''] = match;
  return [...(intro ? [intro] : []), heading, rest];
}

function buildSections(lines: string[]): RulingSection[] {
  const sections: RulingSection[] = [];
  let section: RulingSection | undefined;
  const partiesEnd = endOfParties(lines);

  const open = (heading: string, role: RulingSectionRole): RulingSection => {
    section = { heading, role, paragraphs: [], subsections: [] };
    sections.push(section);
    return section;
  };
  const current = (): RulingSection => section ?? open(OPENING_HEADING, 'opening');
  const addParagraph = (paragraph: string) => {
    const target = current();
    (target.subsections.at(-1) ?? target).paragraphs.push(paragraph);
  };

  lines.forEach((line, index) => {
    const judgeRole = judgeSectionRole(line);
    if (judgeRole) {
      open(judgeRole === 'addition' ? 'Tillägg' : 'Skiljaktig mening', judgeRole);
      addParagraph(line);
      return;
    }
    if (!isHeadingLike(line) || introducesList(line, lines[index + 1])) {
      addParagraph(line);
      return;
    }
    if ((section?.role ?? 'opening') === 'opening' && index <= partiesEnd) {
      // Party names, "Nr 13", "mot" and the like.
      addParagraph(line);
      return;
    }

    const heading = normalizeHeading(line);
    const lastSubsection = section?.subsections.at(-1);
    const insidePartyCase = lastSubsection !== undefined && lastSubsection.paragraphs.length === 0;
    if (insidePartyCase && OPEN_ENDED_HEADING.test(lastSubsection.heading)) {
      lastSubsection.heading = `${lastSubsection.heading} ${heading}`;
      return;
    }
    const role = insidePartyCase ? undefined : mainSectionRole(heading, sections, section?.role);
    if (role) {
      open(heading, role);
    } else {
      current().subsections.push({ heading, paragraphs: [] });
    }
  });
  return sections;
}

/** Whether `line` is a lead-in to the list or continuation in `next`, not a heading. */
function introducesList(line: string, next: string | undefined): boolean {
  if (next === undefined || !CONTINUATION.test(next)) return false;
  // "Domslut" and the other known headings are often followed by a numbered list.
  const heading = normalizeHeading(line);
  return !REASONS.test(heading) && !RULING.test(heading) && !PROCEEDINGS.test(heading);
}

/**
 * The index of the last line of AD's party block: "Nr 13", claimant, "mot", respondent, repeated
 * for joined cases. Only lines before the first main heading count.
 */
function endOfParties(lines: string[]): number {
  let end = -1;
  for (const [index, line] of lines.entries()) {
    if (isHeadingLike(line) && mainSectionRole(normalizeHeading(line), [], undefined)) break;
    if (line === 'mot') end = index + 1;
  }
  return end;
}

/** The role of the main section `heading` opens, or `undefined` when it is a sub-section. */
function mainSectionRole(
  heading: string,
  sections: RulingSection[],
  previous: RulingSectionRole = 'opening',
): RulingSectionRole | undefined {
  if (REASONS.test(heading)) return 'reasons';
  if (RULING.test(heading)) return 'ruling';
  // Before the court's reasons, Bakgrund, Yrkanden … are main sections; after them, and when they
  // repeat for each party, sub-sections.
  const beforeReasons = previous === 'opening' || previous === 'proceedings';
  const repeated = sections.some((section) => section.heading === heading);
  return beforeReasons && !repeated && PROCEEDINGS.test(heading) ? 'proceedings' : undefined;
}

/** `dissent` or `addition` when the paragraph opens a judge's separate opinion. */
function judgeSectionRole(line: string): 'dissent' | 'addition' | undefined {
  if (!JUDGE.test(line)) return undefined;
  if (DISSENT.test(line)) return 'dissent';
  return ADDITION.test(line) ? 'addition' : undefined;
}

/** A short line starting with a capital, without closing punctuation or a colon before text. */
function isHeadingLike(line: string): boolean {
  return (
    line.length <= MAX_HEADING_LENGTH &&
    /^\p{Lu}/u.test(line) &&
    !/[.,;:]$/.test(line) &&
    // "Överklagade domen: Kalmar tingsrätts dom …" is a statement, while "HD:s bedömning" is a heading.
    !/:\s/.test(line)
  );
}

/** "DOMSKÄL" becomes "Domskäl"; headings in mixed case and short acronyms stay as they are. */
function normalizeHeading(line: string): string {
  // Acronyms and numerals such as "DO", "LAS" or "III" stay as they are.
  const isKnownHeading = REASONS.test(line) || RULING.test(line) || PROCEEDINGS.test(line);
  if (line !== line.toUpperCase() || !(isKnownHeading || /\p{Lu}{5,}/u.test(line))) return line;
  return line.charAt(0) + line.slice(1).toLowerCase();
}

function titleOf(name: unknown, summary: string, identifier: string): string {
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  const firstSentence = firstSentenceOf(summary);
  if (firstSentence === '') return identifier;
  return firstSentence.length <= MAX_TITLE_LENGTH
    ? firstSentence
    : `${firstSentence.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** Up to the first full stop that ends a sentence, not an abbreviation such as "s.k." or "bl.a.". */
function firstSentenceOf(text: string): string {
  for (const match of text.matchAll(/[.?!](?=\s+\p{Lu}|$)/gu)) {
    const end = match.index + 1;
    if (!ABBREVIATION_END.test(text.slice(0, end))) return text.slice(0, end).trim();
  }
  return text.trim();
}

function renderText(sections: RulingSection[]): string {
  return sections
    .flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...section.subsections.flatMap((subsection) => [
        subsection.heading,
        ...subsection.paragraphs,
      ]),
    ])
    .join('\n\n');
}
