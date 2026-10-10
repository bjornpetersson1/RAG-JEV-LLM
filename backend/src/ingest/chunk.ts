import type { ChunkConfig } from './chunk-config.js';
import type {
  DocumentStructure,
  LawStructure,
  RulingStructure,
  RulingSubsection,
} from './structure.js';

export interface Chunk {
  /** Exact place in the source, e.g. `SFS 1982:80 7 § st. 2` or `AD 1994 nr 79, Domskäl, Tystnadsplikt`. */
  sourceRef: string;
  /** Document title and heading path, put in front of the text when a model reads the chunk. */
  context: string;
  text: string;
}

export interface ChunkableDocument {
  identifier: string;
  title: string;
  structure: DocumentStructure;
}

/** A typical ratio for Swedish text; an estimate, since no tokenizer is used. */
const CHARACTERS_PER_TOKEN = 3.5;
const CONTEXT_SEPARATOR = ' › ';
const PARAGRAPH_SEPARATOR = '\n\n';

/** The estimated number of model tokens in `text`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

/**
 * A citable unit before splitting: a law section, a transitional entry, or a ruling section or
 * group of sub-sections.
 */
interface Unit {
  sourceRef: string;
  context: string;
  paragraphs: string[];
  /** Law sections cite split parts by paragraph (`st. 2`); everything else by part (`del 2/3`). */
  citesParagraphs: boolean;
}

/** Splits a document into chunks no longer than `config.maxChars`, in document order. */
export function chunkDocument(document: ChunkableDocument, config: ChunkConfig): Chunk[] {
  const units =
    document.structure.kind === 'law'
      ? lawUnits(document, document.structure)
      : rulingUnits(document, document.structure, config);
  const chunks = numberRepeatedReferences(units).flatMap((unit) => splitUnit(unit, config));
  return makeReferencesUnique(chunks);
}

function lawUnits(document: ChunkableDocument, structure: LawStructure): Unit[] {
  const units: Unit[] = [];
  for (const chapter of structure.chapters) {
    const chapterRef = chapter.number === null ? null : `${chapter.number} kap.`;
    const chapterContext =
      chapterRef === null ? null : [chapterRef, chapter.title].filter(Boolean).join(' ');
    for (const section of chapter.sections) {
      const sectionLabel = `${section.number} §`;
      const [first, ...rest] = section.paragraphs;
      units.push({
        sourceRef: [document.identifier, chapterRef, sectionLabel].filter(Boolean).join(' '),
        context: contextOf(document.title, chapterContext, section.heading, sectionLabel),
        // The text starts with the section number, as in the source.
        paragraphs: [first === undefined ? sectionLabel : `${sectionLabel} ${first}`, ...rest],
        citesParagraphs: true,
      });
    }
  }
  for (const entry of structure.transitional) {
    units.push({
      sourceRef: `${document.identifier} övergångsbestämmelser ${entry.sfs}`,
      context: contextOf(document.title, 'Övergångsbestämmelser', entry.sfs),
      paragraphs: entry.paragraphs.length > 0 ? entry.paragraphs : [entry.sfs],
      citesParagraphs: false,
    });
  }
  return units;
}

function rulingUnits(
  document: ChunkableDocument,
  structure: RulingStructure,
  config: ChunkConfig,
): Unit[] {
  const units: Unit[] = [];
  const documentContext = contextOf(document.identifier, document.title);
  const headingCounts = new Map<string, number>();
  for (const section of structure.sections) {
    // A repeated main heading is numbered here, so its sub-sections cite the right one.
    const count = (headingCounts.get(section.heading) ?? 0) + 1;
    headingCounts.set(section.heading, count);
    const sectionRef = `${document.identifier}, ${section.heading}${count > 1 ? ` (${count})` : ''}`;
    if (section.paragraphs.length > 0 || section.subsections.length === 0) {
      units.push({
        sourceRef: sectionRef,
        context: contextOf(documentContext, section.heading),
        paragraphs: section.paragraphs.length > 0 ? section.paragraphs : [section.heading],
        citesParagraphs: false,
      });
    }
    for (const group of groupShortSubsections(section.subsections, config)) {
      const headings = group.map((subsection) => subsection.heading).join(' – ');
      units.push({
        sourceRef: `${sectionRef}, ${headings}`,
        context: contextOf(documentContext, section.heading, headings),
        paragraphs: group.flatMap(subsectionParagraphs),
        citesParagraphs: false,
      });
    }
  }
  return units;
}

/**
 * Groups each sub-section shorter than the minimum with the next one (the last with the previous),
 * so a heading with little or no text of its own is not a chunk by itself. A group longer than the
 * maximum is split like any other unit.
 */
function groupShortSubsections(
  subsections: RulingSubsection[],
  config: ChunkConfig,
): RulingSubsection[][] {
  const isShort = (group: RulingSubsection[]) =>
    joinedLength(group.flatMap(subsectionParagraphs)) < config.minChars;
  const groups: RulingSubsection[][] = [];
  for (const subsection of subsections) {
    const previous = groups.at(-1);
    if (previous && isShort(previous)) previous.push(subsection);
    else groups.push([subsection]);
  }
  const last = groups.at(-1);
  const beforeLast = groups.at(-2);
  if (last && beforeLast && isShort(last)) {
    beforeLast.push(...last);
    groups.pop();
  }
  return groups;
}

/** A sub-section's text starts with its heading. */
function subsectionParagraphs(subsection: RulingSubsection): string[] {
  return [subsection.heading, ...subsection.paragraphs];
}

/** A unit reference that repeats within the document, e.g. a second sub-section "Bakgrund" under the same heading, gets " (2)", " (3)" … */
function numberRepeatedReferences(units: Unit[]): Unit[] {
  const seen = new Map<string, number>();
  return units.map((unit) => {
    const count = (seen.get(unit.sourceRef) ?? 0) + 1;
    seen.set(unit.sourceRef, count);
    return count === 1 ? unit : { ...unit, sourceRef: `${unit.sourceRef} (${count})` };
  });
}

/**
 * The last guard for the unique (document, source_ref) key: a split suffix can still produce a
 * reference that another unit already has, e.g. a heading that itself ends in "(2)".
 */
function makeReferencesUnique(chunks: Chunk[]): Chunk[] {
  const seen = new Set<string>();
  return chunks.map((chunk) => {
    let sourceRef = chunk.sourceRef;
    for (let count = 2; seen.has(sourceRef); count += 1)
      sourceRef = `${chunk.sourceRef} (${count})`;
    seen.add(sourceRef);
    return sourceRef === chunk.sourceRef ? chunk : { ...chunk, sourceRef };
  });
}

/** Whole paragraphs, or one part of a paragraph too long for a chunk on its own. */
interface Piece {
  paragraphs: string[];
  /** Positions in the unit of the paragraphs the piece holds. */
  indices: number[];
  /** Set for a part of a split paragraph: its number and the paragraph's number of parts. */
  part?: { index: number; count: number };
}

function splitUnit(unit: Unit, config: ChunkConfig): Chunk[] {
  const chunkOf = (sourceRef: string, paragraphs: string[]): Chunk => ({
    sourceRef,
    context: unit.context,
    text: paragraphs.join(PARAGRAPH_SEPARATOR),
  });
  if (joinedLength(unit.paragraphs) <= config.maxChars) {
    return [chunkOf(unit.sourceRef, unit.paragraphs)];
  }
  const pieces = packParagraphs(unit, config);
  fillShortTail(pieces, unit, config);
  return pieces.map((piece, index) =>
    chunkOf(pieceReference(unit, piece, index, pieces.length), piece.paragraphs),
  );
}

/**
 * Packs paragraphs greedily up to the maximum and splits a paragraph that is too long. A unit
 * that cites paragraphs keeps parts of a split paragraph apart from whole ones, so `st. 2, del 1/2`
 * stays exact; in other units they share chunks, and a short lead such as a sub-section heading is
 * split together with the long paragraph after it.
 */
function packParagraphs(unit: Unit, config: ChunkConfig): Piece[] {
  const pieces: Piece[] = [];
  unit.paragraphs.forEach((paragraph, index) => {
    const previous = pieces.at(-1);
    if (paragraph.length <= config.maxChars) {
      const fits = joinedLength([...(previous?.paragraphs ?? []), paragraph]) <= config.maxChars;
      if (previous && fits && !(unit.citesParagraphs && previous.part)) {
        previous.paragraphs.push(paragraph);
        previous.indices.push(index);
      } else {
        pieces.push({ paragraphs: [paragraph], indices: [index] });
      }
      return;
    }
    const lead =
      !unit.citesParagraphs && previous && isShort(previous, config) ? pieces.pop() : undefined;
    const text = [...(lead?.paragraphs ?? []), paragraph].join(PARAGRAPH_SEPARATOR);
    const parts = splitLongText(text, config.maxChars);
    parts.forEach((part, partIndex) =>
      pieces.push({
        paragraphs: [part],
        indices: [index],
        part: { index: partIndex + 1, count: parts.length },
      }),
    );
  });
  return pieces;
}

/**
 * A last piece shorter than the minimum takes whole paragraphs from the end of the piece before
 * it, while that piece keeps at least one and the last one stays within the maximum.
 */
function fillShortTail(pieces: Piece[], unit: Unit, config: ChunkConfig): void {
  const tail = pieces.at(-1);
  const before = pieces.at(-2);
  if (!tail || !before || before.part || (unit.citesParagraphs && tail.part)) return;
  while (isShort(tail, config) && before.paragraphs.length > 1) {
    const moved = before.paragraphs.at(-1)!;
    if (joinedLength([moved, ...tail.paragraphs]) > config.maxChars) return;
    tail.paragraphs.unshift(moved);
    tail.indices.unshift(before.indices.at(-1)!);
    before.paragraphs.pop();
    before.indices.pop();
  }
}

function isShort(piece: Piece, config: ChunkConfig): boolean {
  return joinedLength(piece.paragraphs) < config.minChars;
}

function pieceReference(unit: Unit, piece: Piece, index: number, count: number): string {
  if (!unit.citesParagraphs) return `${unit.sourceRef}, del ${index + 1}/${count}`;
  const first = (piece.indices.at(0) ?? 0) + 1;
  const last = (piece.indices.at(-1) ?? 0) + 1;
  const paragraphs = first === last ? `${first}` : `${first}–${last}`;
  const part = piece.part ? `, del ${piece.part.index}/${piece.part.count}` : '';
  return `${unit.sourceRef} st. ${paragraphs}${part}`;
}

/**
 * Splits text longer than `maxChars` at line and sentence ends, then at spaces, then anywhere,
 * into parts of at most `maxChars`. The parts joined by spaces are the text up to whitespace.
 */
function splitLongText(text: string, maxChars: number): string[] {
  const units = text
    .split(/\n|(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) =>
      sentence.length <= maxChars ? [sentence] : wordSlices(sentence, maxChars),
    );
  // Greedy packing can leave a tiny last part (2,030 characters → 2,000 + 30), so the same number
  // of parts is packed again with the smallest limit that still fits, which evens them out.
  const count = packWithSpaces(units, maxChars).length;
  const even = Math.ceil(text.length / count);
  for (let limit = even; limit < maxChars; limit += Math.ceil(maxChars / 100)) {
    const parts = packWithSpaces(units, limit);
    if (parts.length <= count) return parts;
  }
  return packWithSpaces(units, maxChars);
}

/** Joins units with spaces into parts of at most `limit` characters; a longer unit stays whole. */
function packWithSpaces(units: string[], limit: number): string[] {
  const parts: string[] = [];
  for (const unit of units) {
    const last = parts.at(-1);
    if (last !== undefined && last.length + 1 + unit.length <= limit) {
      parts[parts.length - 1] = `${last} ${unit}`;
    } else {
      parts.push(unit);
    }
  }
  return parts;
}

/** The words of `sentence`, with any word longer than `maxChars` cut into slices that fit. */
function wordSlices(sentence: string, maxChars: number): string[] {
  return sentence.split(/\s+/).flatMap((word) => {
    const slices: string[] = [];
    for (let start = 0; start < word.length; start += maxChars) {
      slices.push(word.slice(start, start + maxChars));
    }
    return slices;
  });
}

function joinedLength(paragraphs: string[]): number {
  return paragraphs.join(PARAGRAPH_SEPARATOR).length;
}

function contextOf(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(CONTEXT_SEPARATOR);
}
