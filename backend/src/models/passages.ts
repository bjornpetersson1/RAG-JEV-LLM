import type { DatabaseSync } from 'node:sqlite';
import type { Chunk } from '../llm/types.js';

/** The instruction the model benchmarks score chunks against, so their tables can be compared. */
export const BENCH_INSTRUCTION =
  'Anställningsavtal för en säljare med sex månaders provanställning och konkurrensklausul';

/**
 * What a local model reads for a chunk: its heading path (law or case title, chapter, section),
 * then its text. Unlike the judge's `judgedText` (source reference and text), the heading path
 * names the law in words, which the query's spelled-out abbreviations match. A chunk without a
 * heading path is read as the judge reads it.
 */
export function passageText({
  context,
  text,
  source,
}: {
  context?: string;
  text: string;
  source?: string;
}): string {
  if (context) return `${context}\n${text}`;
  return source ? `${source}\n\n${text}` : text;
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

/**
 * `count` chunks spread evenly over the corpus by id, as the query flow loads them, so their
 * lengths are typical, for timing the reranker. Fewer when the corpus is smaller.
 */
export function loadSampleChunks(db: DatabaseSync, count: number): Chunk[] {
  const ids = (db.prepare('SELECT id FROM chunks ORDER BY id').all() as { id: number }[]).map(
    ({ id }) => id,
  );
  const picked = Array.from(
    { length: Math.min(count, ids.length) },
    (_, i) => ids[Math.floor((i * ids.length) / Math.min(count, ids.length))],
  );
  const select = db.prepare('SELECT id, text, source_ref, context FROM chunks WHERE id = ?');
  return picked.map((id) => {
    const row = select.get(id) as { text: string; source_ref: string; context: string };
    return { id: String(id), text: row.text, source: row.source_ref, context: row.context };
  });
}
