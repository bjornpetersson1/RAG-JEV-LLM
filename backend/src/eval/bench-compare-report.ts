// The table of `bench:compare` (E5-4): printed, and appended to the "Main flow vs reference RAG:
// time to sources" table in that day's `eval/report-<date>.md`.

import type { Latency } from '../stats.js';
import type { FlowSummary } from './bench-compare.js';
import {
  appendToReportTable,
  formatLatency,
  formatTable,
  tableRow,
  type ReportTable,
} from './report-file.js';
import { formatScore } from './report.js';

const BENCH_TABLE: ReportTable = {
  // A new heading since E7-8 added columns, so rows never land under an older table's header.
  heading: '## Main flow vs reference RAG: time to sources',
  introduction: [
    'Rows from `npm run bench:compare`, appended per run. Each query runs through both flows the',
    'given number of times; times are the median and p90 over every run, in ms. Sources is the time',
    'to sources: search plus rerank, without the translation, which is part of LLM time. Search',
    'includes embedding the instruction; generation is also given per output token (ms/token) with',
    "the drafts' output tokens. LLM time is query translation, generation and a remote (LLM or JEV)",
    'rerank. Precision and recall are of the chunks sent to the generator, macro averages over the',
    'queries, averaged over the runs; source accuracy is valid references / all references over',
    'every draft (E6-3). A query and run that failed in either flow is left out of both, so the flows',
    'are compared on the same samples; – marks a step that did not run.',
  ],
  columns: [
    'date',
    'flow',
    'configuration',
    'total',
    'translation',
    'sources',
    'search',
    'embedding',
    'rerank',
    'generation',
    'ms/token',
    'output tokens',
    'LLM',
    'precision',
    'recall',
    'source accuracy',
    'samples',
    'queries',
    'drafts',
    'runs',
    'failures',
  ],
};

export function benchRows(summaries: readonly FlowSummary[], date: string): string[] {
  return summaries.map(({ measured, ...summary }) => {
    const latency = (value: Latency | undefined) => (value ? formatLatency(value) : '–');
    const score = (value: number | null | undefined) =>
      value === null || value === undefined ? '–' : formatScore(value);
    return tableRow([
      date,
      summary.flow,
      summary.configuration,
      latency(measured?.total),
      latency(measured?.translation),
      latency(measured?.sources),
      latency(measured?.search),
      latency(measured?.embedding),
      latency(measured?.rerank),
      latency(measured?.generation),
      measured?.generationPerToken ? formatLatency(measured.generationPerToken, 1) : '–',
      latency(measured?.outputTokens),
      latency(measured?.llm),
      score(measured?.relevance.precision),
      score(measured?.relevance.recall),
      score(measured?.sourceAccuracy),
      String(summary.samples),
      String(summary.queries),
      String(summary.drafts),
      String(summary.runs),
      String(summary.failures),
    ]);
  });
}

export function benchTable(summaries: readonly FlowSummary[], date: string): string {
  return formatTable(BENCH_TABLE, benchRows(summaries, date));
}

export function appendBenchToReport(
  path: string,
  summaries: readonly FlowSummary[],
  date: string,
): void {
  appendToReportTable(path, BENCH_TABLE, benchRows(summaries, date), date);
}
