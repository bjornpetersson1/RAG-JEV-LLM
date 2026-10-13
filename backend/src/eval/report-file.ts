// Tables that grow across runs in that day's `eval/report-<date>.md` (E8-5, E5-4): each table has
// its own section, and every run appends its rows, so rows from different days line up.

import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomically } from '../ingest/files.js';
import { escapeCell } from '../reports.js';
import type { Latency } from '../stats.js';

export interface ReportTable {
  /** The section heading, e.g. `## Retriever and reranker comparison`. */
  heading: string;
  /** The paragraph between the heading and the table. */
  introduction: string[];
  columns: string[];
}

/** One Markdown table row. */
export function tableRow(cells: readonly string[]): string {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

/** The heading, introduction and table with `rows`, for the terminal or a new report. */
export function formatTable(table: ReportTable, rows: readonly string[]): string {
  return [table.heading, '', ...table.introduction, '', ...tableHead(table), ...rows].join('\n');
}

/**
 * Appends the rows to the table's section in the report at `path`: after the table's last row when
 * the section has a table, else as a new table at the end of that section, else as a new section
 * at the end of the report (creating the report for `date` if needed).
 */
export function appendToReportTable(
  path: string,
  table: ReportTable,
  rows: readonly string[],
  date: string,
): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : `# Evaluation ${date}\n`;
  const lines = existing.replace(/\n+$/, '').split('\n');
  const heading = lines.indexOf(table.heading);
  if (heading === -1) {
    writeFileAtomically(path, `${[...lines, '', formatTable(table, rows)].join('\n')}\n`);
    return;
  }
  const next = lines.findIndex((line, i) => i > heading && line.startsWith('## '));
  const sectionEnd = next === -1 ? lines.length : next;
  const tableStart = lines.findIndex(
    (line, i) => i > heading && i < sectionEnd && line.startsWith('|'),
  );
  if (tableStart === -1) {
    lines.splice(sectionEnd, 0, '', ...tableHead(table), ...rows, '');
  } else {
    let end = tableStart;
    while (end < sectionEnd && lines[end].startsWith('|')) end += 1;
    lines.splice(end, 0, ...rows);
  }
  writeFileAtomically(path, `${lines.join('\n').replace(/\n+$/, '')}\n`);
}

/** `median / p90`, in whole milliseconds unless `decimals` asks for more. */
export function formatLatency({ median, p90 }: Latency, decimals = 0): string {
  return `${median.toFixed(decimals)} / ${p90.toFixed(decimals)}`;
}

function tableHead({ columns }: ReportTable): string[] {
  return [tableRow(columns), tableRow(columns.map(() => '---'))];
}
