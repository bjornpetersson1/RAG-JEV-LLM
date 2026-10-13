// Turns the draft's references into Markdown links before it is rendered (E7-2): a reference the
// post-check matched to a sent chunk links to that chunk; one it flagged links to `#flag` with the
// reason as its title. The post-check's offsets are into the draft as written, so this runs before
// Markdown parsing.

import type { PostCheck } from './query';

export const FLAG_LINK = '#flag';

/** One reference: where it is, the citation id if it is one, and where its link goes. */
interface Reference {
  start: number;
  end: number;
  citation?: string;
  target: string;
}

/**
 * The draft with every matched reference as a link to `sourceLink(chunkId)` and every flag as a flag
 * link. A reference inside a code span or an existing link is left as written.
 */
export function linkReferences(
  text: string,
  { matches, flags }: PostCheck,
  sourceLink: (chunkId: string) => string,
): string {
  const references: Reference[] = [
    ...matches.map(({ kind, start, end, chunkId }) => ({
      start,
      end,
      citation: kind === 'citation' ? chunkId : undefined,
      target: sourceLink(chunkId),
    })),
    ...flags.map(({ kind, start, end, chunkId, reason }) => ({
      start,
      end,
      citation: kind === 'citation' ? chunkId : undefined,
      target: `${FLAG_LINK} "${reason.replace(/"/g, "'")}"`,
    })),
  ];
  const spans = new Map<string, Reference[]>();
  for (const reference of references) {
    const key = `${reference.start}:${reference.end}`;
    spans.set(key, [...(spans.get(key) ?? []), reference]);
  }
  const ordered = [...spans.values()].sort((a, b) => a[0].start - b[0].start);

  let linked = '';
  let at = 0;
  for (const span of ordered) {
    const { start, end } = span[0];
    if (start < at || insideMarkup(text, start, end)) continue;
    linked += text.slice(at, start) + linkSpan(text.slice(start, end), span);
    at = end;
  }
  return linked + text.slice(at);
}

/**
 * A free-text reference becomes one link; a citation group such as `[K:12, K:40]` one link per id,
 * in the order written. The ids are read as the backend's `findCitations` reads them, and an id
 * without a reference is kept as written.
 */
function linkSpan(written: string, span: Reference[]): string {
  const [first] = span;
  if (first.citation === undefined) return markdownLink(written, first.target);
  const targets = new Map(span.map(({ citation, target }) => [citation, target]));
  return written
    .slice('[K:'.length, -']'.length)
    .split(',')
    .map((item) => item.trim().replace(/^K:\s*/, ''))
    .filter((id) => id !== '')
    .map((id) => {
      const target = targets.get(id);
      return target ? markdownLink(`[K:${id}]`, target) : escapeMarkdown(`[K:${id}]`);
    })
    .join('');
}

/** Whether the span is inside a code span or the text of a link on its line. */
function insideMarkup(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd === -1 ? undefined : lineEnd);
  const inCode = (before.match(/`/g)?.length ?? 0) % 2 === 1;
  const inLinkText = before.lastIndexOf('[') > before.lastIndexOf(']') && /^[^[]*\]\(/.test(after);
  return inCode || inLinkText;
}

function markdownLink(label: string, target: string): string {
  return `[${escapeMarkdown(label)}](${target})`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\[\]*_`]/g, '\\$&');
}
