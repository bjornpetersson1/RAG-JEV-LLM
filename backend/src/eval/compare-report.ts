// The comparison table of `eval:run --reranker` (E8-5): printed, and appended as rows to the table
// in that day's `eval/report-<date>.md`. Every report uses the same columns, so rows from different
// days can be put side by side.

import type { ComparisonRow, ListMeasures } from './compare.js';
import { GRADE_SCOPES } from './queries.js';
import {
  appendToReportTable,
  formatLatency,
  formatTable,
  tableRow,
  type ReportTable,
} from './report-file.js';
import { formatScore } from './report.js';

/**
 * E7-4 added the grade and precision before rerank, E9-1 the query translator and its latency;
 * reports from before keep their earlier tables under `## Retriever and reranker comparison` and
 * `## Retriever and reranker comparison, graded`.
 */
export const COMPARISON_HEADING = '## Retriever and reranker comparison, graded, with translation';

const COMPARISON_TABLE: ReportTable = {
  heading: COMPARISON_HEADING,
  introduction: [
    'Rows from `npm run eval:run -- --reranker … --retriever …`, appended per run. "Before" is the',
    'retriever\'s own order; "after" is the reranker\'s order, keeping every relevant candidate.',
    'Recall and precision are macro averages over the evaluation queries; P@K is relevant chunks among',
    'the first K divided by K. Each pair has a row per grade: `central` counts the chunks the clause',
    'rests on, `all` every graded chunk (E7-4). `tags` is tag search without the full-text fallback',
    '(E5-3), `fts` the full-text baseline. The labels are not yet reviewed by the owner (#79).',
    'A retriever that uses tags names the query translator and the time it took per query (E9-1).',
  ],
  columns: [
    'date',
    'retriever',
    'reranker',
    'model',
    'dtype',
    'translator',
    'candidates',
    'grade',
    'R@5 before',
    'R@8 before',
    'R@10 before',
    'R@cand before',
    'P@5 before',
    'P@10 before',
    'R@5 after',
    'R@8 after',
    'R@10 after',
    'R@cand after',
    'P@5 after',
    'P@10 after',
    'rerank ms median / p90',
    'retrieval ms median / p90',
    'translation ms median / p90',
    'queries',
    'notes',
  ],
};

/** The rows as Markdown table lines, one per grade, dated `date` (YYYY-MM-DD). */
export function comparisonRows(rows: readonly ComparisonRow[], date: string): string[] {
  return rows.flatMap((row) =>
    GRADE_SCOPES.map((grade) =>
      tableRow([
        date,
        row.retriever,
        row.reranker,
        row.model,
        row.dtype,
        row.translator,
        row.candidates.toFixed(1),
        grade,
        ...measureCells(row.before[grade]),
        ...(row.after ? measureCells(row.after[grade]) : MEASURE_KEYS.map(() => '–')),
        row.rerankMs ? formatLatency(row.rerankMs) : '–',
        formatLatency(row.retrievalMs),
        row.translationMs ? formatLatency(row.translationMs) : '–',
        String(row.queries),
        row.notes.join('; '),
      ]),
    ),
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

/** The columns of one list's measures, in table order. */
const MEASURE_KEYS = ['5', '8', '10', 'candidates', 'precision5', 'precision10'] as const;

function measureCells(measures: ListMeasures): string[] {
  return MEASURE_KEYS.map((key) => formatScore(measures[key]));
}
