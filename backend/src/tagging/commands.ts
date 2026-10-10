import type { DatabaseSync } from 'node:sqlite';
import type { ReportConfig } from './config.js';
import { buildReport } from './report.js';
import { formatReportForTerminal, formatRunSummary, writeReport } from './report-format.js';
import { syncVocabulary } from './sync-vocabulary.js';
import { tagChunks, type TagChunksOptions } from './tag-chunks.js';
import type { Vocabulary } from './vocabulary.js';

/** Where the report goes: printed, and written as a file to `reportsDir`. */
interface ReportOutput {
  reportsDir: string;
  print: (text: string) => void;
}

export type TagCommandOptions = TagChunksOptions & ReportConfig & ReportOutput;

/** `index:tag`: tags the chunks, then prints the run summary and the control report. */
export async function tagCommand(options: TagCommandOptions): Promise<number> {
  const summary = await tagChunks(options);
  options.print(formatRunSummary(summary));
  printReport(options.db, options.vocabulary.version, options);
  return summary.failed > 0 ? 1 : 0;
}

export type ReportCommandOptions = { db: DatabaseSync; vocabulary: Vocabulary } & ReportConfig &
  ReportOutput;

/**
 * `index:report`: syncs the vocabulary, as `index:tag` does, so the tag list matches the file the
 * version comes from, then prints the control report without tagging.
 */
export function reportCommand(options: ReportCommandOptions): number {
  syncVocabulary(options.db, options.vocabulary.tags);
  printReport(options.db, options.vocabulary.version, options);
  return 0;
}

function printReport(
  db: DatabaseSync,
  vocabularyVersion: string,
  { broadShare, reportsDir, print }: ReportConfig & ReportOutput,
): void {
  const report = buildReport(db, { vocabularyVersion, broadShare });
  print(formatReportForTerminal(report));
  print(`Report written to ${writeReport(report, reportsDir)}`);
}
