import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomically } from '../ingest/files.js';
import { formatUsd } from '../llm/pricing.js';
import { TAGS_PER_CHUNK } from '../llm/roles.js';
import type { ChunkReference, TagCount, TaggingReport } from './report.js';
import type { TaggingSummary } from './tag-chunks.js';

/** The terminal lists at most this many chunks without tags; the file lists all. */
export const TERMINAL_CHUNK_LIMIT = 50;

/** The report as plain text for the terminal. */
export function formatReportForTerminal(report: TaggingReport): string {
  const shown = report.chunksWithoutTags.slice(0, TERMINAL_CHUNK_LIMIT);
  const hidden = report.chunksWithoutTags.length - shown.length;
  const countWidth = String(Math.max(0, ...report.tags.map((tag) => tag.chunks))).length;
  return [
    `Tagging report (model ${report.model ?? 'none: no tagging run yet'}, vocabulary ${report.vocabularyVersion})`,
    '',
    ...summaryLines(report).map((line) => `  ${line}`),
    '',
    `Chunks per tag (broad: more than ${percent(report.broadShare)} of the chunks with tags):`,
    ...report.tags.map(
      (tag) =>
        `  ${String(tag.chunks).padStart(countWidth)}  ${percent(tag.share).padStart(4)}  ` +
        `${tag.slug} – ${tag.label} [${tag.area}]${tag.broad ? '  BROAD' : ''}`,
    ),
    '',
    `Chunks without tags (${report.chunksWithoutTags.length}):`,
    ...(shown.length === 0 ? ['  none'] : shown.map((chunk) => `  ${describeChunk(chunk)}`)),
    ...(hidden > 0 ? [`  … and ${hidden} more (see the report file)`] : []),
  ].join('\n');
}

/** The report as Markdown, listing every chunk without tags. */
export function formatReportAsMarkdown(report: TaggingReport): string {
  return [
    '# Tagging report',
    '',
    `Model \`${report.model ?? 'none'}\`${report.model ? '' : ' (no tagging run yet)'}, vocabulary \`${report.vocabularyVersion}\`.`,
    '',
    '## Summary',
    '',
    ...summaryLines(report).map((line) => `- ${line}`),
    '',
    '## Chunks per tag',
    '',
    `Broad: more than ${percent(report.broadShare)} of the chunks with tags.`,
    '',
    '| Chunks | Share | Tag | Label | Area | Broad |',
    '| ---: | ---: | --- | --- | --- | --- |',
    ...report.tags.map(tagRow),
    '',
    `## Chunks without tags (${report.chunksWithoutTags.length})`,
    '',
    ...(report.chunksWithoutTags.length === 0
      ? ['None.']
      : report.chunksWithoutTags.map((chunk) => `- ${describeChunk(chunk)}`)),
    '',
  ].join('\n');
}

/** Writes the Markdown report to `<dir>/tagging-<UTC timestamp>.md` and returns the path. */
export function writeReport(report: TaggingReport, dir: string, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  // Two reports within one second (e.g. index:tag then index:report) must not overwrite each other.
  const base = join(dir, `tagging-${fileTimestamp(now)}`);
  let path = `${base}.md`;
  for (let copy = 2; existsSync(path); copy += 1) path = `${base}-${copy}.md`;
  writeFileAtomically(path, formatReportAsMarkdown(report));
  return path;
}

/** The `index:tag` run summary for the terminal. */
export function formatRunSummary(summary: TaggingSummary): string {
  const seconds = (Date.parse(summary.finishedAt) - Date.parse(summary.startedAt)) / 1000;
  const { usage } = summary;
  const perChunk =
    summary.costUsd === undefined || summary.tagged === 0
      ? undefined
      : summary.costUsd / summary.tagged;
  return [
    `Tagging with ${summary.model}, vocabulary ${summary.vocabularyVersion}:`,
    `  chunks: tagged ${summary.tagged}, skipped ${summary.skipped}, failed ${summary.failed}` +
      (summary.remaining > 0 ? `, left for a later run ${summary.remaining}` : ''),
    `  discarded slugs ${summary.discardedSlugs}; chunks with fewer than ${TAGS_PER_CHUNK.min} tags ${summary.belowMin}, cut to ${TAGS_PER_CHUNK.max} tags ${summary.aboveMax}`,
    `  tokens: input ${usage.inputTokens}, output ${usage.outputTokens}, cache write ${usage.cacheWriteTokens}, cache read ${usage.cacheReadTokens}`,
    `  estimated cost: ${formatUsd(summary.costUsd)} in total, ${formatUsd(perChunk)} per tagged chunk`,
    `  time: ${seconds.toFixed(1)} s`,
  ].join('\n');
}

function summaryLines({ summary, latestRun, chunksWithoutTags }: TaggingReport): string[] {
  const run = latestRun
    ? `latest tagging run: ${latestRun.finishedAt}, model ${latestRun.model}, ` +
      `vocabulary ${latestRun.vocabularyVersion}; for its ${latestRun.chunksTagged} tagged chunks ` +
      `${latestRun.discardedSlugs} discarded out-of-vocabulary slugs, estimated cost ` +
      formatUsd(latestRun.costUsd)
    : 'latest tagging run: none yet';
  return [
    `chunks: ${summary.totalChunks} in total, ${summary.taggedChunks} tagged with this model and ` +
      `vocabulary, ${summary.outdatedChunks} not yet tagged or out of date`,
    `tagged chunks: ${summary.chunksWithTags} with tags, ${chunksWithoutTags.length} without, ` +
      `${summary.chunksBelowMin} with fewer than ${TAGS_PER_CHUNK.min}`,
    `average tags per chunk with tags: ${summary.averageTags.toFixed(1)}`,
    `tags: ${summary.tagsWithoutChunks} with no chunks, ${summary.broadTags} broad`,
    run,
  ];
}

function tagRow(tag: TagCount): string {
  const cells = [
    tag.chunks,
    percent(tag.share),
    `\`${tag.slug}\``,
    escapeCell(tag.label),
    escapeCell(tag.area),
    tag.broad ? 'yes' : '',
  ];
  return `| ${cells.join(' | ')} |`;
}

/** A pipe would end the table cell early. */
function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function describeChunk(chunk: ChunkReference): string {
  return `#${chunk.id} ${chunk.sourceRef}`;
}

function percent(share: number): string {
  const rounded = Math.round(share * 100);
  // A tag on a few chunks must not look like one on none.
  return share > 0 && rounded === 0 ? '<1%' : `${rounded}%`;
}

/** E.g. `20261010T143000Z`: sortable and safe in file names on every platform. */
function fileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
