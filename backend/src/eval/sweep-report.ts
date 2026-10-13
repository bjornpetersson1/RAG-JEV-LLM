// The sweep's table (E7-4): printed, and appended to the "Candidate count and top-k sweep" table in
// that day's `eval/report-<date>.md`, with the setting the rule chooses per retriever.

import {
  appendToReportTable,
  formatLatency,
  formatTable,
  tableRow,
  type ReportTable,
} from './report-file.js';
import { formatScore } from './report.js';
import { GRADE_SCOPES } from './queries.js';
import type { CandidateSweepRow, SweepChoice } from './sweep.js';

const SWEEP_TABLE: ReportTable = {
  heading: '## Candidate count and top-k sweep',
  introduction: [
    'Rows from `npm run eval:run -- --sweep`, appended per run. For each count, the retriever built',
    'for it gives its own list; each query’s lists are reranked once together, and top-k',
    'keeps the best k of those. Precision, recall and F1 are macro averages of the kept chunks,',
    'against the central chunks and against every graded chunk. The rerank time is an estimate:',
    'each query’s rerank time per candidate times its N candidates (median / p90, ms). `chosen`',
    'marks the setting the rule picks per retriever (E7-4); `baseline` the defaults before it.',
  ],
  columns: [
    'date',
    'retriever',
    'reranker',
    'candidates',
    'top-k',
    ...GRADE_SCOPES.flatMap((scope) => [`${scope} P`, `${scope} R`, `${scope} F1`]),
    'rerank ms (est.)',
    'queries',
    'rule',
  ],
};

export function sweepRows(
  rows: readonly CandidateSweepRow[],
  choices: readonly SweepChoice[],
  reranker: string,
  date: string,
): string[] {
  return rows.map((row) => {
    const choice = choices.find(({ retriever }) => retriever === row.retriever);
    const marks = [
      ...(choice?.baseline === row ? ['baseline'] : []),
      ...(choice?.chosen === row ? ['chosen'] : []),
    ];
    return tableRow([
      date,
      row.retriever,
      reranker,
      String(row.candidates),
      String(row.topK),
      ...GRADE_SCOPES.flatMap((scope) => {
        const { precision, recall, f1 } = row.scores[scope];
        return [precision, recall, f1].map(formatScore);
      }),
      formatLatency(row.rerankMs),
      String(row.queries),
      marks.join(', '),
    ]);
  });
}

export function sweepTable(
  rows: readonly CandidateSweepRow[],
  choices: readonly SweepChoice[],
  reranker: string,
  date: string,
): string {
  return formatTable(SWEEP_TABLE, sweepRows(rows, choices, reranker, date));
}

export function appendSweepToReport(
  path: string,
  rows: readonly CandidateSweepRow[],
  choices: readonly SweepChoice[],
  reranker: string,
  date: string,
): void {
  appendToReportTable(path, SWEEP_TABLE, sweepRows(rows, choices, reranker, date), date);
}
