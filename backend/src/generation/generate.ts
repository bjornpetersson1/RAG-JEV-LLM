import { elapsedMs } from '../http.js';
import { NO_USAGE, type LlmUsage } from '../llm/client.js';
import type { Chunk, Generator } from '../llm/types.js';
import type { ContextLimits } from './config.js';
import { selectContext, type ContextSelection } from './context.js';
import { checkDraft, type PostCheck } from './post-check.js';
import { findCitations, loadPromptTemplate } from './templates.js';

export interface DraftRequest {
  /** The template id, e.g. `employment`. */
  template: string;
  instruction: string;
  /** The approved chunks, best first. */
  chunks: readonly Chunk[];
  parties?: string;
}

export interface GenerationDependencies {
  generator: Generator;
  limits: ContextLimits;
}

export type ContextReport = { limits: ContextLimits } & Pick<
  ContextSelection,
  'limitedBy' | 'needed'
>;

export interface GenerationResult {
  /**
   * The Markdown draft as written, ending with the template's disclaimer line. Absent when no
   * approved chunk fit the context limits, in which case the generator was not called.
   */
  text?: string;
  /** Submitted chunks the draft cites, in order of first citation. */
  used: Chunk[];
  /** Submitted chunks the draft does not cite, in context order. */
  unused: Chunk[];
  /** Approved chunks the context limits kept out, in rank order. */
  leftOut: Chunk[];
  /** The references in `text` checked against the submitted chunks (E6-3); absent without text. */
  check?: PostCheck;
  context: ContextReport;
  elapsedMs: number;
  usage: LlmUsage;
}

/**
 * Drafts a contract from the best approved chunks that fit the context limits and maps the draft's
 * `[K:<id>]` citations to those chunks. The text is left as the model wrote it, apart from the
 * template's disclaimer line, which is appended unless the draft already ends with it.
 */
export async function generateDraft(
  request: DraftRequest,
  { generator, limits }: GenerationDependencies,
): Promise<GenerationResult> {
  const started = performance.now();
  const { disclaimer } = loadPromptTemplate(request.template);
  const { submitted, leftOut, limitedBy, needed } = selectContext(request.chunks, limits);
  const context = { limits, limitedBy, needed };
  if (submitted.length === 0) {
    const nothingSent = { used: [], unused: [], usage: NO_USAGE };
    return { ...nothingSent, leftOut, context, elapsedMs: elapsedMs(started) };
  }

  const draft = await generator.generate({ ...request, chunks: submitted });
  const byId = new Map(submitted.map((chunk) => [chunk.id, chunk]));
  // A Set keeps insertion order, so this is the cited ids in order of first citation.
  const text = withDisclaimer(draft.text, disclaimer);
  const citations = findCitations(text);
  const cited = new Set(citations.map(({ id }) => id));
  return {
    text,
    used: [...cited].flatMap((id) => byId.get(id) ?? []),
    unused: submitted.filter((chunk) => !cited.has(chunk.id)),
    leftOut,
    check: checkDraft(text, submitted, citations),
    context,
    elapsedMs: elapsedMs(started),
    usage: draft.usage,
  };
}

function withDisclaimer(text: string, disclaimer: string): string {
  const trimmed = text.trimEnd();
  // The model may drop the line's Markdown emphasis; the words must still end the draft.
  const words = disclaimer.replace(/^[_*]+|[_*]+$/g, '');
  return trimmed.replace(/[_*]+$/, '').endsWith(words) ? trimmed : `${trimmed}\n\n${disclaimer}`;
}
