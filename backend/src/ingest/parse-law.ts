import { decodeHtmlEntities } from './html.js';
import type { LawChapter, LawSection, LawStructure, TransitionalEntry } from './structure.js';

export interface ParsedLaw {
  title: string;
  sfsNumber: string;
  /** "Utfärdad", ISO `YYYY-MM-DD`. */
  issuedOn: string;
  /** "Ändring införd: t.o.m. SFS …", or `null` when the page has none. */
  consolidatedThrough: string | null;
  /** The law text with hard line breaks inside paragraphs joined, blocks separated by blank lines. */
  text: string;
  structure: LawStructure;
  /** Numbers of sections left out because they are repealed. */
  repealed: string[];
  /** Numbers of section versions left out because they are not in force on the import date. */
  notInForce: string[];
}

export class LawParseError extends Error {}

const BODY = /<div class="result-box-text body-text">([\s\S]*?)<\/div>/;
const TITLE = /<span class="bold">([^<]*\(\d{4}:\d+\)[^<]*)<\/span>/;
const SFS_NUMBER = /SFS-nummer\s*·\s*(\d{4}:\d+)/;
const ISSUED_ON = /Utfärdad:<\/span>\s*(\d{4}-\d{2}-\d{2})/;
const CONSOLIDATED_THROUGH = /Ändring införd:<\/span>\s*t\.o\.m\. SFS\s*(\d{4}:\d+)/;

const TRANSITIONAL_HEADING = 'Övergångsbestämmelser';
const CHAPTER_START = /^(\d+(?: [a-z])?) kap\. (\p{Lu}.*)$/u;
const SECTION_START = /^(\d+(?: [a-z])?) §(?:\s+([\s\S]*))?$/;
// SFST prints both versions of a section that is about to change, each with its date.
const VERSION_MARKER =
  /^\/(?:Upphör att gälla|Träder i kraft) (?<kind>[UI]):(?<date>\d{4}-\d{2}-\d{2})\/\s*/;
const REPEALED = /^har upphävts genom (?:lag|förordning) \(\d{4}:\d+\)\.?$/i;
// SFST occasionally leaves out the final full stop.
const AMENDMENT_NOTE = /\s*(?:Lag|Förordning) \((\d{4}:\d+)\)\.?$/;
const LIST_ITEM = /^(?:\d+\.|[a-zåäö][.)]|[-–])\s/;
// Headings may end in an abbreviation such as "m.m.", "m. m." or "m.fl.", but not in a sentence.
const ABBREVIATION_END = /(?:^|\s)(?:\p{L}+\.\s?)+\p{L}+\.$/u;
const TRANSITIONAL_ENTRY = /^\d{4}:\d+$/;
const MAX_HEADING_LENGTH = 120;

/**
 * Parses an SFST law page into its header fields and structure tree. `today` (ISO date) decides
 * which version of a section with a pending change is in force.
 */
export function parseLawPage(html: string, today: string): ParsedLaw {
  const page = decodeHtmlEntities(html);
  const title = page.match(TITLE)?.[1]?.replace(/\s+/g, ' ').trim();
  if (!title) throw new LawParseError('No law title found');
  const sfsNumber = page.match(SFS_NUMBER)?.[1];
  if (!sfsNumber) throw new LawParseError('No SFS number found');
  const issuedOn = page.match(ISSUED_ON)?.[1];
  if (!issuedOn) throw new LawParseError('No "Utfärdad" date found');
  const body = html.match(BODY)?.[1];
  if (body === undefined) throw new LawParseError('No law text found');

  const blocks = splitBlocks(decodeHtmlEntities(body));
  const transitionalAt = blocks.indexOf(TRANSITIONAL_HEADING);
  const [main, transitional] =
    transitionalAt === -1
      ? [blocks, []]
      : [blocks.slice(0, transitionalAt), blocks.slice(transitionalAt + 1)];

  const { chapters, repealed, notInForce } = parseChapters(main, today);
  if (chapters.every((chapter) => chapter.sections.length === 0)) {
    throw new LawParseError('No sections found');
  }
  chapters.forEach(extractAmendmentNotes);
  const transitionalEntries = parseTransitional(transitional, sfsNumber);
  return {
    title,
    sfsNumber,
    issuedOn,
    consolidatedThrough: page.match(CONSOLIDATED_THROUGH)?.[1] ?? null,
    text: renderText(chapters, transitionalEntries),
    structure: { kind: 'law', chapters, transitional: transitionalEntries },
    repealed,
    notInForce,
  };
}

/** Blocks separated by blank lines, each with its hard line breaks joined into single spaces. */
function splitBlocks(body: string): string[] {
  return body
    .split(/\r?\n[ \t\u00a0]*\r?\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block !== '');
}

function parseChapters(blocks: string[], today: string) {
  const repealed: string[] = [];
  const notInForce: string[] = [];
  let chapter: LawChapter = { number: null, title: null, sections: [] };
  // A law without chapters keeps this first chapter; otherwise it is replaced by "1 kap.".
  const chapters = [chapter];
  let heading: string | null = null;
  // The section the following paragraphs belong to; a left-out version is not added to the chapter.
  let section: LawSection | undefined;
  let previous: { number: string; repealed: boolean } | undefined;

  blocks.forEach((block, index) => {
    const [, chapterNumber, chapterTitle] = block.match(CHAPTER_START) ?? [];
    if (chapterNumber && chapterTitle && isAfter(chapterNumber, chapter.number)) {
      if (chapter.number === null && chapter.sections.length === 0) chapters.pop();
      chapter = { number: chapterNumber, title: chapterTitle, sections: [] };
      chapters.push(chapter);
      heading = null;
      section = undefined;
      previous = undefined;
      return;
    }

    const [, number, rest = ''] = block.match(SECTION_START) ?? [];
    const marker = rest.match(VERSION_MARKER)?.groups;
    const text = rest.replace(VERSION_MARKER, '');
    const isRepealed = REPEALED.test(text);
    if (
      number &&
      // A section's text starts with a capital; "7 § första stycket gäller …" is running text.
      (/^\p{Lu}/u.test(text) || isRepealed) &&
      (isAfter(number, previous?.number ?? null) ||
        // A second version of a section, or a new section reusing a repealed one's number.
        (number === previous?.number && (marker !== undefined || previous.repealed)))
    ) {
      previous = { number, repealed: isRepealed };
      section = { number, heading, paragraphs: text ? [text] : [], amendedBy: null };
      if (isRepealed) {
        repealed.push(sectionLabel(chapter, number));
      } else if (marker && !isInForce(marker.kind!, marker.date!, today)) {
        notInForce.push(sectionLabel(chapter, number));
      } else {
        chapter.sections.push(section);
      }
      return;
    }

    if (isHeading(block, blocks[index + 1])) {
      heading = block;
      section = undefined;
      return;
    }

    if (!section) throw new LawParseError(`Text outside any section: "${block.slice(0, 60)}"`);
    addParagraph(section.paragraphs, block);
  });

  return { chapters, repealed, notInForce };
}

/** Moves each section's trailing amendment note into `amendedBy`. */
function extractAmendmentNotes(chapter: LawChapter): void {
  for (const section of chapter.sections) {
    const last = section.paragraphs.at(-1);
    const note = last?.match(AMENDMENT_NOTE);
    if (!last || !note) continue;
    section.amendedBy = note[1]!;
    section.paragraphs[section.paragraphs.length - 1] = last.slice(0, note.index).trim();
  }
}

function parseTransitional(blocks: string[], ownSfsNumber: string): TransitionalEntry[] {
  const entries: TransitionalEntry[] = [];
  let entry: TransitionalEntry | undefined;
  for (const block of blocks) {
    if (TRANSITIONAL_ENTRY.test(block)) {
      entry = { sfs: block, paragraphs: [] };
      entries.push(entry);
      continue;
    }
    if (!entry) {
      // Older laws print their own provisions without the SFS number first.
      entry = { sfs: ownSfsNumber, paragraphs: [] };
      entries.push(entry);
    }
    addParagraph(entry.paragraphs, block);
  }
  return entries;
}

/**
 * The law text as kept in the tree, so it matches the chunks: no repealed sections, no version
 * that is not in force, no version markers or amendment notes.
 */
function renderText(chapters: LawChapter[], transitional: TransitionalEntry[]): string {
  const blocks: string[] = [];
  for (const chapter of chapters) {
    if (chapter.number !== null) blocks.push(`${chapter.number} kap. ${chapter.title}`);
    let heading: string | null = null;
    for (const section of chapter.sections) {
      if (section.heading !== null && section.heading !== heading) blocks.push(section.heading);
      heading = section.heading;
      const [first = '', ...rest] = section.paragraphs;
      blocks.push(`${section.number} § ${first}`.trim(), ...rest);
    }
  }
  if (transitional.length > 0) blocks.push(TRANSITIONAL_HEADING);
  for (const entry of transitional) blocks.push(entry.sfs, ...entry.paragraphs);
  return blocks.join('\n\n');
}

/** List items belong to the paragraph that introduces them, as Swedish law counts stycken. */
function addParagraph(paragraphs: string[], block: string): void {
  if (LIST_ITEM.test(block) && paragraphs.length > 0) {
    paragraphs[paragraphs.length - 1] += `\n${block}`;
  } else {
    paragraphs.push(block);
  }
}

/** A short line without closing punctuation, followed by a section or another heading. */
function isHeading(block: string, next: string | undefined): boolean {
  return (
    isHeadingLike(block) &&
    next !== undefined &&
    (SECTION_START.test(next) || CHAPTER_START.test(next) || isHeadingLike(next))
  );
}

function isHeadingLike(block: string): boolean {
  return (
    block.length <= MAX_HEADING_LENGTH &&
    /^\p{Lu}/u.test(block) &&
    !/[,;:]$/.test(block) &&
    (!block.endsWith('.') || ABBREVIATION_END.test(block)) &&
    !SECTION_START.test(block)
  );
}

/** `U` marks the version that ends on `date`, `I` the version that starts on it. */
function isInForce(kind: string, date: string, today: string): boolean {
  return kind === 'U' ? today < date : date <= today;
}

/** Whether section or chapter number `number` (e.g. `2 a`) comes after `previous`. */
function isAfter(number: string, previous: string | null): boolean {
  if (previous === null) return true;
  const [value, letter = ''] = number.split(' ');
  const [previousValue, previousLetter = ''] = previous.split(' ');
  const difference = Number(value) - Number(previousValue);
  return difference > 0 || (difference === 0 && letter > previousLetter);
}

function sectionLabel(chapter: LawChapter, number: string): string {
  return chapter.number === null ? `${number} §` : `${chapter.number} kap. ${number} §`;
}
