// The comparison table of `eval:run --reranker` (E8-5): printed, and appended as rows to the table
// in that day's `eval/report-<date>.md`. Every report uses the same columns, so rows from different
// days can be put side by side.

import type { ComparisonRow, RecallAt } from './compare.js';
import {
  appendToReportTable,
  formatLatency,
  formatTable,
  tableRow,
  type ReportTable,
} from './report-file.js';
import { formatScore } from './report.js';

export const COMPARISON_HEADING = '## Retriever and reranker comparison';

const COMPARISON_TABLE: ReportTable = {
  heading: COMPARISON_HEADING,
  introduction: [
    'Rows from `npm run eval:run -- --reranker … --retriever …`, appended per run. "Before" is the',
    'retriever\'s own order; "after" is the reranker\'s order, keeping every relevant candidate.',
    'Recall and precision are macro averages over the evaluation queries; P@K is relevant chunks among',
    'the first K divided by K. `tags` is tag search without the full-text fallback (E5-3), `fts` the',
    'full-text baseline. The labels in `eval/queries.yaml` are not yet reviewed by the owner (#58).',
  ],
  columns: [
    'date',
    'retriever',
    'reranker',
    'model',
    'dtype',
    'candidates',
    'R@5 before',
    'R@8 before',
    'R@10 before',
    'R@cand before',
    'R@5 after',
    'R@8 after',
    'R@10 after',
    'R@cand after',
    'P@5 after',
    'P@10 after',
    'rerank ms median / p90',
    'retrieval ms median / p90',
    'queries',
    'notes',
  ],
};

/** The rows as Markdown table lines, dated `date` (YYYY-MM-DD). */
export function comparisonRows(rows: readonly ComparisonRow[], date: string): string[] {
  return rows.map((row) =>
    tableRow([
      date,
      row.retriever,
      row.reranker,
      row.model,
      row.dtype,
      row.candidates.toFixed(1),
      ...recallCells(row.before),
      ...(row.after
        ? [
            ...recallCells(row.after),
            formatScore(row.after.precision5),
            formatScore(row.after.precision10),
          ]
        : Array.from({ length: 6 }, () => '–')),
      row.rerankMs ? formatLatency(row.rerankMs) : '–',
      formatLatency(row.retrievalMs),
      String(row.queries),
      row.notes.join('; '),
    ]),
  );
}

/** The heading, introduction and table with `rows`, for the terminal or a new report. */
export function comparisonTable(rows: readonly ComparisonRow[], date: string): string {
  return formatTable(COMPARISON_TABLE, comparisonRows(rows, date));
}

/** Appends the rows to the comparison table in the report at `path`, creating what is missing. */
export function appendToReport(path: string, rows: readonly ComparisonRow[], date: string): void {
  appendToReportTable(path, COMPARISON_TABLE, comparisonRows(rows, date), date);
}

function recallCells(recall: RecallAt): string[] {
  return [recall['5'], recall['8'], recall['10'], recall.candidates].map(formatScore);
}
