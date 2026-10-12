import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomically } from './ingest/files.js';

/**
 * Writes `markdown` to `<dir>/<prefix>-<UTC timestamp>.md` and returns the path. Two reports within
 * one second (e.g. `index:tag` then `index:report`) do not overwrite each other.
 */
export function writeMarkdownReport(
  dir: string,
  prefix: string,
  markdown: string,
  now = new Date(),
): string {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${prefix}-${fileTimestamp(now)}`);
  let path = `${base}.md`;
  for (let copy = 2; existsSync(path); copy += 1) path = `${base}-${copy}.md`;
  writeFileAtomically(path, markdown);
  return path;
}

/** A Markdown table cell; a pipe would end the cell early. */
export function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** E.g. `20261010T143000Z`: sortable and safe in file names on every platform. */
function fileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** `date` in the local time zone as `YYYY-MM-DD`, e.g. for a dated report file. */
export function localDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
