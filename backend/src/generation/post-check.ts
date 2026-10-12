import {
  findFreeTextReferences,
  matches,
  parseSource,
  type LegalReference,
} from '../legal/references.js';
import type { Chunk } from '../llm/types.js';
import { findCitations, type FoundCitation } from './templates.js';

export type ReferenceKind = 'citation' | 'free-text';

export interface ReferenceFlag {
  kind: ReferenceKind;
  /** The reference as written in the draft. */
  text: string;
  /** Offsets in the draft (UTF-16 code units, as JavaScript indexes strings), end exclusive. */
  start: number;
  end: number;
  reason: string;
  /** For a citation, the cited id; a group such as `[K:11, K:99]` shares one span for all ids. */
  chunkId?: string;
}

export interface PostCheck {
  /** References that match no submitted chunk, in text order. */
  flags: ReferenceFlag[];
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
  const sources = submitted.flatMap((chunk) => (chunk.source ? [parseSource(chunk.source)] : []));
  const freeText = findFreeTextReferences(maskCitations(text, citations));
  const flags = [
    ...citations
      .filter(({ id }) => !submittedIds.has(id))
      .map(({ id, start, end }) => ({
        ...flag('citation', text, start, end, `chunk ${id} was not submitted`),
        chunkId: id,
      })),
    ...freeText
      .filter((reference) => !sources.some((source) => matches(reference, source)))
      .map((reference) =>
        flag(
          'free-text',
          text,
          reference.start,
          reference.end,
          `no submitted chunk is from ${describe(reference)}`,
        ),
      ),
  ].sort((a, b) => a.start - b.start);

  const references = citations.length + freeText.length;
  const valid = references - flags.length;
  return {
    flags,
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

function flag(
  kind: ReferenceKind,
  text: string,
  start: number,
  end: number,
  reason: string,
): ReferenceFlag {
  return { kind, text: text.slice(start, end), start, end, reason };
}

function describe({ document, chapter, section }: LegalReference): string {
  if (section === undefined) return document;
  return [document, chapter === undefined ? '' : `${chapter} kap.`, `${section} §`]
    .filter(Boolean)
    .join(' ');
}
