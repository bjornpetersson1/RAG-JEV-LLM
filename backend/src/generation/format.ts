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
  const { judging, draft } = result;
  const lines = [
    `Tags: ${result.tags.join(', ') || '–'}`,
    `Candidates: ${result.candidates} · approved: ${judging.approved} · unknown: ${judging.unknown} · ` +
      `judge calls: ${judging.judgeCalls} · cache hits: ${judging.cacheHits}`,
  ];
  if (draft) {
    lines.push(`Submitted to the generator: ${draft.used.length + draft.unused.length}`, '');
    lines.push(...formatDraft(request, draft));
  } else {
    lines.push('', 'No relevant sources were found, so no draft was generated.');
  }
  lines.push('', ...formatTimings(result));
  return lines.join('\n');
}

function formatDraft(request: QueryRequest, draft: GenerationResult): string[] {
  if (draft.text === undefined) {
    return [
      'No approved chunk fit the context limits, so no draft was generated.',
      '',
      ...formatLimitNotice(request, draft),
    ];
  }
  const lines = [draft.text, ''];
  lines.push(...formatSources(`Sources used (${draft.used.length}):`, draft.used));
  lines.push(...formatSources(`Unused sources (${draft.unused.length}):`, draft.unused));
  if (draft.check) lines.push(...formatCheck(draft.check));
  if (draft.leftOut.length > 0) lines.push('', ...formatLimitNotice(request, draft));
  return lines;
}

function formatCheck({ flags, references, valid, sourceAccuracy }: PostCheck): string[] {
  const accuracy =
    sourceAccuracy === null
      ? '– (no references)'
      : `${Math.floor(sourceAccuracy * 100)} % (${valid} of ${references} references)`;
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

function formatLimitNotice(request: QueryRequest, draft: GenerationResult): string[] {
  const { limits, limitedBy, needed } = draft.context;
  const reasons = limitedBy.map((limit) => `--${LIMIT_OPTIONS[limit]} ${limits[limit]}`).join(', ');
  return [
    `Context limit reached: ${leftOutCount(draft.leftOut.length)} left out (${reasons}).`,
    'To include every approved chunk, run again with a larger context:',
    `  ${rerunCommand(request, needed)}`,
  ];
}

/** The same query with limits large enough for every approved chunk. */
function rerunCommand(request: QueryRequest, needed: ContextLimits): string {
  return [
    'npm run query --',
    shellQuote(request.instruction),
    '--template',
    request.template,
    `--${LIMIT_OPTIONS.maxChunks}`,
    needed.maxChunks,
    `--${LIMIT_OPTIONS.maxContextChars}`,
    needed.maxContextChars,
  ].join(' ');
}

function formatTimings({ timings, usage }: QueryResult): string[] {
  const steps = [
    `translation ${timings.translationMs}`,
    `search ${timings.searchMs}`,
    `judging ${timings.judgingMs}`,
    ...(timings.generationMs === undefined ? [] : [`generation ${timings.generationMs}`]),
    `total ${timings.totalMs}`,
  ];
  return [
    `Time (ms): ${steps.join(' · ')}`,
    `Tokens: translation ${formatUsage(usage.translation)} · judging ${formatUsage(usage.judging)}` +
      (usage.generation ? ` · generation ${formatUsage(usage.generation)}` : ''),
  ];
}

// Cache writes and reads are input too, and with a cached prompt (e.g. the Claude Code provider)
// they are most of it, so they are shown next to the normally billed input.
function formatUsage(usage: LlmUsage | undefined): string {
  if (!usage) return '–';
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
