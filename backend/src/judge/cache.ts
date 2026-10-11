import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, preparedOnce } from '../db/database.js';
import { judgedText, relevanceQuestion } from '../llm/judge-question.js';
import type { Chunk } from '../llm/types.js';
import { collapseWhitespace } from '../text.js';
import type { PrimaryJudge } from './factory.js';

export interface JudgeCache {
  /** The cached scores of `chunks`, by chunk id; misses are absent. */
  read(chunks: readonly Chunk[]): Map<string, number>;
  /** Stores the scores in one transaction. */
  write(scored: readonly { chunk: Chunk; score: number }[]): void;
}

const statementsFor = preparedOnce((db) => ({
  select: db.prepare(
    `SELECT chunk_id, text_hash, score FROM judge_cache
     WHERE key = ? AND chunk_id IN (SELECT value FROM json_each(?))`,
  ),
  upsert: db.prepare(
    `INSERT OR REPLACE INTO judge_cache (key, chunk_id, text_hash, judge, model, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
}));

/**
 * The `judge_cache` rows for one instruction and judge. The key is the question the judge is asked,
 * built from the normalized instruction (lower-cased, whitespace collapsed), so trivially different
 * spellings share entries and a change of wording starts afresh. A chunk whose judged text changed
 * since it was cached is a miss.
 */
export function createJudgeCache(
  db: DatabaseSync,
  instruction: string,
  judge: PrimaryJudge,
): JudgeCache {
  const question = relevanceQuestion(collapseWhitespace(instruction).toLowerCase());
  const key = sha256(JSON.stringify([question, judge.impl, judge.model]));
  const textHashes = new Map<string, string>();
  const textHash = (chunk: Chunk): string => {
    let hash = textHashes.get(chunk.id);
    if (hash === undefined) {
      hash = sha256(judgedText(chunk));
      textHashes.set(chunk.id, hash);
    }
    return hash;
  };

  return {
    read(chunks) {
      const ids = JSON.stringify(chunks.map((chunk) => chunk.id));
      const rows = statementsFor(db).select.all(key, ids) as unknown as CacheRow[];
      const byId = new Map(rows.map((row) => [row.chunk_id, row]));
      const hits = new Map<string, number>();
      for (const chunk of chunks) {
        const row = byId.get(chunk.id);
        if (row?.text_hash === textHash(chunk)) hits.set(chunk.id, row.score);
      }
      return hits;
    },
    write(scored) {
      if (scored.length === 0) return;
      const { upsert } = statementsFor(db);
      const createdAt = new Date().toISOString();
      inTransaction(db, () => {
        for (const { chunk, score } of scored) {
          upsert.run(key, chunk.id, textHash(chunk), judge.impl, judge.model, score, createdAt);
        }
      });
    },
  };
}

interface CacheRow {
  chunk_id: string;
  text_hash: string;
  score: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
