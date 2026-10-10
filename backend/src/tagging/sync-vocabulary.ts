import type { DatabaseSync } from 'node:sqlite';
import { inTransaction } from '../db/database.js';
import { TAG_FIELDS, type VocabularyTag } from './vocabulary.js';

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

/**
 * Makes the `tags` table match the vocabulary by slug, in one transaction. Deleting a tag also
 * deletes its chunk links through the foreign key cascade.
 */
export function syncVocabulary(db: DatabaseSync, tags: readonly VocabularyTag[]): SyncResult {
  const result: SyncResult = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
  const insert = db.prepare(
    'INSERT INTO tags (slug, label, description, area) VALUES (?, ?, ?, ?)',
  );
  const update = db.prepare('UPDATE tags SET label = ?, description = ?, area = ? WHERE slug = ?');
  const remove = db.prepare('DELETE FROM tags WHERE slug = ?');

  inTransaction(db, () => {
    const stored = new Map(
      (
        db
          .prepare('SELECT slug, label, description, area FROM tags')
          .all() as unknown as VocabularyTag[]
      ).map((tag) => [tag.slug, tag]),
    );
    const seen = new Set<string>();
    for (const tag of tags) {
      // A repeated slug would be counted as unchanged and then hit the unique key on insert.
      if (seen.has(tag.slug)) throw new Error(`Duplicate tag slug ${tag.slug}`);
      seen.add(tag.slug);
      const existing = stored.get(tag.slug);
      stored.delete(tag.slug);
      if (!existing) {
        insert.run(tag.slug, tag.label, tag.description, tag.area);
        result.inserted++;
      } else if (TAG_FIELDS.some((field) => existing[field] !== tag[field])) {
        update.run(tag.label, tag.description, tag.area, tag.slug);
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
    for (const slug of stored.keys()) {
      remove.run(slug);
      result.deleted++;
    }
  });
  return result;
}
