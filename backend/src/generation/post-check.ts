import {
  findFreeTextReferences,
  matches,
  parseSource,
  type LegalReference,
} from '../legal/references.js';
import type { Chunk } from '../llm/types.js';
import { findCitations, type FoundCitation } from './templates.js';

export type ReferenceKind = 'citation' | 'free-text';

/** Where a reference is in the draft, as written there. */
export interface ReferenceSpan {
  kind: ReferenceKind;
  /** The reference as written in the draft. */
  text: string;
  /** Offsets in the draft (UTF-16 code units, as JavaScript indexes strings), end exclusive. */
  start: number;
  end: number;
}

export interface ReferenceFlag extends ReferenceSpan {
  reason: string;
  /** For a citation, the cited id; a group such as `[K:11, K:99]` shares one span for all ids. */
  chunkId?: string;
}

/** A reference that points to a submitted chunk, so the UI can link it to that chunk (E7-2). */
export interface ReferenceMatch extends ReferenceSpan {
  /** A citation group such as `[K:11, K:12]` shares one span for all ids. */
  chunkId: string;
}

export interface PostCheck {
  /** References that match no submitted chunk, in text order. */
  flags: ReferenceFlag[];
  /** References that match a submitted chunk, in text order. */
  matches: ReferenceMatch[];
  /** Every `[K:]` citation and detected free-text reference, each occurrence counted. */
  references: number;
  valid: number;
  /** `valid / references`, or null for a draft without references. */
  sourceAccuracy: number | null;
}

/**
 * Checks every reference in a draft against the chunks sent to the generator: `[K:<id>]` citations
 * by id, free-text statute, provision and case references by the chunks' source references.
 */
export function checkDraft(
  text: string,
  submitted: readonly Chunk[],
  citations: readonly FoundCitation[] = findCitations(text),
): PostCheck {
  const submittedIds = new Set(submitted.map((chunk) => chunk.id));
  const sources = submitted.flatMap((chunk) =>
    chunk.source ? [{ chunkId: chunk.id, source: parseSource(chunk.source) }] : [],
  );
  const freeText = findFreeTextReferences(maskCitations(text, citations));
  const flags: ReferenceFlag[] = [];
  const found: ReferenceMatch[] = [];
  for (const { id, start, end } of citations) {
    const at = span('citation', text, start, end);
    if (submittedIds.has(id)) found.push({ ...at, chunkId: id });
    else flags.push({ ...at, chunkId: id, reason: `chunk ${id} was not submitted` });
  }
  for (const reference of freeText) {
    const at = span('free-text', text, reference.start, reference.end);
    const source = sources.find(({ source }) => matches(reference, source));
    if (source) found.push({ ...at, chunkId: source.chunkId });
    else flags.push({ ...at, reason: `no submitted chunk is from ${describe(reference)}` });
  }
  flags.sort((a, b) => a.start - b.start);
  found.sort((a, b) => a.start - b.start);

  const references = citations.length + freeText.length;
  const valid = references - flags.length;
  return {
    flags,
    matches: found,
    references,
    valid,
    sourceAccuracy: sourceAccuracy(valid, references),
  };
}

/** E6-3's source accuracy: valid references / all references, or null without references. */
export function sourceAccuracy(valid: number, references: number): number | null {
  return references === 0 ? null : valid / references;
}

/** Blanks out `[K:]` citations, keeping offsets, so their ids are not read as free text. */
function maskCitations(text: string, citations: readonly FoundCitation[]): string {
  const pieces: string[] = [];
  let at = 0;
  for (const { start, end } of citations) {
    // Every id of a group shares the group's span, so only its first id moves `at` on.
    if (start < at) continue;
    pieces.push(text.slice(at, start), ' '.repeat(end - start));
    at = end;
  }
  pieces.push(text.slice(at));
  return pieces.join('');
}

function span(kind: ReferenceKind, text: string, start: number, end: number): ReferenceSpan {
  return { kind, text: text.slice(start, end), start, end };
}

function describe({ document, chapter, section }: LegalReference): string {
  if (section === undefined) return document;
  return [document, chapter === undefined ? '' : `${chapter} kap.`, `${section} §`]
    .filter(Boolean)
    .join(' ');
}
