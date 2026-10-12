// The comparison table of `eval:run --reranker` (E8-5): printed, and appended as rows to the table
// in that day's `eval/report-<date>.md`. Every report uses the same columns, so rows from different
// days can be put side by side.

import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomically } from '../ingest/files.js';
import { escapeCell } from '../reports.js';
import type { ComparisonRow, Latency, RecallAt } from './compare.js';
import { formatScore } from './report.js';

export const COMPARISON_HEADING = '## Retriever and reranker comparison';

const HEADER = [
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
];

const INTRODUCTION = [
  COMPARISON_HEADING,
  '',
  'Rows from `npm run eval:run -- --reranker … --retriever …`, appended per run. "Before" is the',
  'retriever\'s own order; "after" is the reranker\'s order, keeping every relevant candidate.',
  'Recall and precision are macro averages over the evaluation queries; P@K is relevant chunks among',
  'the first K divided by K. `tags` is tag search without the full-text fallback (E5-3), `fts` the',
  'full-text baseline. The labels in `eval/queries.yaml` are not yet reviewed by the owner (#58).',
  '',
  `| ${HEADER.join(' | ')} |`,
  `| ${HEADER.map(() => '---').join(' | ')} |`,
];

/** The rows as Markdown table lines, dated `date` (YYYY-MM-DD). */
export function comparisonRows(rows: readonly ComparisonRow[], date: string): string[] {
  return rows.map((row) => {
    const cells = [
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
      row.rerankMs ? latency(row.rerankMs) : '–',
      latency(row.retrievalMs),
      String(row.queries),
      row.notes.join('; '),
    ];
    return `| ${cells.map(escapeCell).join(' | ')} |`;
  });
}

/** The heading, introduction and table with `rows`, for the terminal or a new report. */
export function comparisonTable(rows: readonly ComparisonRow[], date: string): string {
  return [...INTRODUCTION, ...comparisonRows(rows, date)].join('\n');
}

/**
 * Appends the rows to the comparison table in the report at `path`: after the table's last row when
 * the comparison section has a table, else as a new table at the end of that section, else as a new
 * section at the end of the report (creating the report if needed).
 */
export function appendToReport(path: string, rows: readonly ComparisonRow[], date: string): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : `# Evaluation ${date}\n`;
  const lines = existing.replace(/\n+$/, '').split('\n');
  const heading = lines.indexOf(COMPARISON_HEADING);
  if (heading === -1) {
    writeFileAtomically(path, `${[...lines, '', comparisonTable(rows, date)].join('\n')}\n`);
    return;
  }
  const next = lines.findIndex((line, i) => i > heading && line.startsWith('## '));
  const sectionEnd = next === -1 ? lines.length : next;
  const tableStart = lines.findIndex(
    (line, i) => i > heading && i < sectionEnd && line.startsWith('|'),
  );
  if (tableStart === -1) {
    lines.splice(sectionEnd, 0, '', ...INTRODUCTION.slice(-2), ...comparisonRows(rows, date), '');
  } else {
    let end = tableStart;
    while (end < sectionEnd && lines[end].startsWith('|')) end += 1;
    lines.splice(end, 0, ...comparisonRows(rows, date));
  }
  writeFileAtomically(path, `${lines.join('\n').replace(/\n+$/, '')}\n`);
}

function recallCells(recall: RecallAt): string[] {
  return [recall['5'], recall['8'], recall['10'], recall.candidates].map(formatScore);
}

function latency({ median, p90 }: Latency): string {
  return `${Math.round(median)} / ${Math.round(p90)}`;
}
