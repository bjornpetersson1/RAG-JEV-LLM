import type { LlmUsage } from '../llm/client.js';
import type { Chunk } from '../llm/types.js';
import type { ContextLimits } from './config.js';
import type { GenerationResult } from './generate.js';
import type { PostCheck } from './post-check.js';
import { LIMIT_OPTIONS } from './query-args.js';
import type { QueryRequest, QueryResult } from './query-flow.js';
import { citation } from './templates.js';

/** The query result for the terminal: what was found, the draft, its sources and the timings. */
export function formatQueryResult(request: QueryRequest, result: QueryResult): string {
  const { draft } = result;
  const lines = formatHeader(result);
  if (draft) {
    lines.push(`Submitted to the generator: ${draft.used.length + draft.unused.length}`, '');
    lines.push(...formatDraft(request, draft, rerunOptions(result)));
  } else {
    lines.push('', 'No relevant sources were found, so no draft was generated.');
  }
  lines.push('', ...formatTimings(result));
  return lines.join('\n');
}

function formatHeader({ flow, tags, candidates, approved, judging }: QueryResult): string[] {
  const found =
    flow === 'reference'
      ? `Reference RAG: the ${candidates} chunks BM25 ranks best for the instruction (no tags)`
      : `Tags: ${tags.join(', ') || '–'}`;
  if (!judging) return [found];
  return [
    found,
    `Candidates: ${candidates} · approved: ${formatApproved(approved.length, judging.relevant)} · ` +
      `unknown: ${judging.unknown} · judge calls: ${judging.judgeCalls} · cache hits: ${judging.cacheHits}`,
  ];
}

/** The approved count, and how many relevant chunks `RERANK_TOP_K` left out. */
function formatApproved(approved: number, relevant: number): string {
  if (relevant <= approved) return String(approved);
  return `${approved} (the best of ${relevant} relevant; raise RERANK_TOP_K to keep more)`;
}

/** What `npm run query` needs besides the instruction and limits to run the same flow again. */
function rerunOptions({ flow }: QueryResult): string[] {
  return flow === 'reference' ? ['--reference'] : [];
}

function formatDraft(
  request: QueryRequest,
  draft: GenerationResult,
  rerun: readonly string[],
): string[] {
  if (draft.text === undefined) {
    return [
      'No approved chunk fit the context limits, so no draft was generated.',
      '',
      ...formatLimitNotice(request, draft, rerun),
    ];
  }
  const lines = [draft.text, ''];
  lines.push(...formatSources(`Sources used (${draft.used.length}):`, draft.used));
  lines.push(...formatSources(`Unused sources (${draft.unused.length}):`, draft.unused));
  if (draft.check) lines.push(...formatCheck(draft.check));
  if (draft.leftOut.length > 0) lines.push('', ...formatLimitNotice(request, draft, rerun));
  return lines;
}

// Whole percent from the counts, since e.g. 0.29 × 100 is 28.999… in floating point.
function formatCheck({ flags, references, valid, sourceAccuracy }: PostCheck): string[] {
  const accuracy =
    sourceAccuracy === null
      ? '– (no references)'
      : `${Math.floor((valid * 100) / references)} % (${valid} of ${references} references)`;
  return [
    `Source accuracy: ${accuracy}`,
    `Flagged references (${flags.length}):`,
    ...flags.map(
      ({ kind, text, start, end, reason }) => `  ${start}–${end} ${kind} "${text}": ${reason}`,
    ),
  ];
}

function formatSources(heading: string, chunks: readonly Chunk[]): string[] {
  return [
    heading,
    ...chunks.map((chunk) => `  ${citation(chunk.id)} ${chunk.source ?? ''}`.trimEnd()),
  ];
}

function formatLimitNotice(
  request: QueryRequest,
  { context, leftOut }: GenerationResult,
  rerun: readonly string[],
): string[] {
  const { limits, limitedBy, needed } = context;
  const reasons = limitedBy.map((limit) => `--${LIMIT_OPTIONS[limit]} ${limits[limit]}`).join(', ');
  return [
    `Context limit reached: ${leftOutCount(leftOut.length)} left out (${reasons}).`,
    'To include every approved chunk, run again with a larger context:',
    `  ${rerunCommand(request, needed, rerun)}`,
  ];
}

/** The same query with limits large enough for every approved chunk. */
function rerunCommand(
  request: QueryRequest,
  needed: ContextLimits,
  options: readonly string[],
): string {
  return [
    'npm run query --',
    shellQuote(request.instruction),
    '--template',
    request.template,
    `--${LIMIT_OPTIONS.maxChunks}`,
    needed.maxChunks,
    `--${LIMIT_OPTIONS.maxContextChars}`,
    needed.maxContextChars,
    ...options,
  ].join(' ');
}

function formatTimings({ timings, usage }: QueryResult): string[] {
  const step = (name: string, ms: number | undefined) =>
    ms === undefined ? [] : [`${name} ${ms}`];
  const steps = [
    ...step('translation', timings.translationMs),
    `search ${timings.searchMs}`,
    ...step('judging', timings.judgingMs),
    `sources ${timings.sourcesMs}`,
    ...step('generation', timings.generationMs),
    `total ${timings.totalMs}`,
  ];
  const tokens = (['translation', 'judging', 'generation'] as const).flatMap((name) =>
    usage[name] ? [`${name} ${formatUsage(usage[name])}`] : [],
  );
  return [`Time (ms): ${steps.join(' · ')}`, `Tokens: ${tokens.join(' · ') || '–'}`];
}

// Cache writes and reads are input too, and with a cached prompt (e.g. the Claude Code provider)
// they are most of it, so they are shown next to the normally billed input.
function formatUsage(usage: LlmUsage): string {
  const cached = usage.cacheWriteTokens + usage.cacheReadTokens;
  const input = cached > 0 ? `${usage.inputTokens} + cache ${cached}` : `${usage.inputTokens}`;
  return `in ${input} / out ${usage.outputTokens}`;
}

function leftOutCount(count: number): string {
  return count === 1 ? '1 approved chunk was' : `${count} approved chunks were`;
}

/** Single-quoted for a POSIX shell, so the printed command can be pasted as is. */
function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
