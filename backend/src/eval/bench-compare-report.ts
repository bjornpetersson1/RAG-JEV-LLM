// The table of `bench:compare` (E5-4): printed, and appended to the "Main flow vs reference RAG:
// the same judge" table in that day's `eval/report-<date>.md`.

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
  // A new heading whenever the columns change (E7-9, then E10-1 dropped the embedding column), so
  // rows never land under an older table's header.
  heading: '## Main flow vs BM25 reference RAG: the same judge',
  introduction: [
    'Rows from `npm run bench:compare`, appended per run. Each query runs through both flows the',
    'given number of times; times are the median and p90 over every run, in ms. Sources is the time',
    'to sources: search plus rerank, without the translation, which is part of LLM time. The',
    'reference RAG searches with BM25. Judged is the median number of candidates given to the',
    'rerank, unknown the candidates it could not score over every run. LLM time is query',
    'translation, generation and a remote (LLM, JEV or SubQ) rerank. Precision and recall are of the',
    'chunks sent to the generator, macro averages over the queries, averaged over the runs. A query',
    'and run that failed in either flow is left out of both, so the flows are compared on the same',
    'samples. Generation, ms/token, output tokens and source accuracy (valid references / all',
    'references, E6-3) are over the samples where both flows wrote a draft; without draft counts the',
    'samples where the rerank approved nothing. – marks a step that did not run.',
  ],
  columns: [
    'date',
    'flow',
    'configuration',
    'total',
    'translation',
    'sources',
    'search',
    'rerank',
    'judged',
    'unknown',
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
    'without draft',
    'runs',
    'failures',
  ],
};

export function benchRows(summaries: readonly FlowSummary[], date: string): string[] {
  return summaries.map(({ measured, ...summary }) => {
    const latency = (value: Latency | undefined) => (value ? formatLatency(value) : '–');
    const score = (value: number | null | undefined) =>
      value === null || value === undefined ? '–' : formatScore(value);
    const count = (value: number | undefined) => (value === undefined ? '–' : String(value));
    return tableRow([
      date,
      summary.flow,
      summary.configuration,
      latency(measured?.total),
      latency(measured?.translation),
      latency(measured?.sources),
      latency(measured?.search),
      latency(measured?.rerank),
      count(measured?.judgedCandidates),
      count(measured?.unknown),
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
      count(summary.withoutDraft),
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
