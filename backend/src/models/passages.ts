import type { DatabaseSync } from 'node:sqlite';

/**
 * What a local model reads for a chunk: its heading path (law or case title, chapter, section),
 * then its text. Unlike the judge's `judgedText` (source reference and text), the heading path
 * names the law in words, which the query's spelled-out abbreviations match.
 */
export function passageText({ context, text }: { context: string; text: string }): string {
  return `${context}\n${text}`;
}

type PassageRow = { context: string; text: string };

/** The texts of the first `count` chunks by id, for timing the models on real text. */
export function loadSamplePassages(db: DatabaseSync, count: number): string[] {
  const rows = db
    .prepare('SELECT context, text FROM chunks ORDER BY id LIMIT ?')
    .all(count) as unknown as PassageRow[];
  return rows.map(passageText);
}

/** The text of the chunk with this source reference; throws when there is none. */
export function loadPassage(db: DatabaseSync, sourceRef: string): string {
  const row = db.prepare('SELECT context, text FROM chunks WHERE source_ref = ?').get(sourceRef) as
    PassageRow | undefined;
  if (!row) throw new Error(`No chunk "${sourceRef}" in the database; run the data import first`);
  return passageText(row);
}
