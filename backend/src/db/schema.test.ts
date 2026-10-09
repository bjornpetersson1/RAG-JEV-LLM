import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { migrate } from './migrations.js';

const DOCUMENT = {
  type: 'law',
  title: 'Lag (1982:80) om anställningsskydd',
  identifier: 'SFS 1982:80',
  court: null,
  date: '1982-02-24',
  source_url: 'https://example.org/sfs-1982-80',
  fetched_at: '2026-10-09T12:00:00.000Z',
  raw_text: '1 § Denna lag gäller arbetstagare…',
};
const CHUNK = {
  ordinal: 6,
  source_ref: 'SFS 1982:80 7 §',
  text: 'En uppsägning…',
  token_count: 42,
};
const TAG = {
  slug: 'uppsagning',
  label: 'Uppsägning',
  description: 'Uppsägning av anställning',
  area: 'anställning',
};
const LINK = {
  model: 'claude-opus-5-5',
  vocabulary_version: 'v1',
  created_at: '2026-10-09T12:05:00.000Z',
};

function insertDocument(db: DatabaseSync, overrides: Partial<typeof DOCUMENT> = {}): number {
  const row = { ...DOCUMENT, ...overrides };
  return Number(
    db
      .prepare(
        `INSERT INTO documents (type, title, identifier, court, date, source_url, fetched_at, raw_text)
         VALUES (:type, :title, :identifier, :court, :date, :source_url, :fetched_at, :raw_text)`,
      )
      .run(row).lastInsertRowid,
  );
}

function insertChunk(db: DatabaseSync, documentId: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO chunks (document_id, ordinal, source_ref, text, token_count)
         VALUES (:document_id, :ordinal, :source_ref, :text, :token_count)`,
      )
      .run({ document_id: documentId, ...CHUNK }).lastInsertRowid,
  );
}

function insertTag(db: DatabaseSync): number {
  return Number(
    db
      .prepare(
        'INSERT INTO tags (slug, label, description, area) VALUES (:slug, :label, :description, :area)',
      )
      .run(TAG).lastInsertRowid,
  );
}

function insertLink(db: DatabaseSync, chunkId: number, tagId: number): void {
  db.prepare(
    `INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at)
     VALUES (:chunk_id, :tag_id, :model, :vocabulary_version, :created_at)`,
  ).run({ chunk_id: chunkId, tag_id: tagId, ...LINK });
}

function count(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}

describe('schema', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('stores a document, chunk, tag and link and reads them back', () => {
    const documentId = insertDocument(db);
    const chunkId = insertChunk(db, documentId);
    const tagId = insertTag(db);
    insertLink(db, chunkId, tagId);

    const row = db
      .prepare(
        `SELECT d.type, d.title, d.identifier, d.court, d.date, d.source_url, d.fetched_at, d.raw_text,
                c.document_id, c.ordinal, c.source_ref, c.text, c.token_count,
                t.slug, t.label, t.description, t.area,
                ct.chunk_id, ct.tag_id, ct.model, ct.vocabulary_version, ct.created_at
         FROM chunk_tags ct
         JOIN chunks c ON c.id = ct.chunk_id
         JOIN documents d ON d.id = c.document_id
         JOIN tags t ON t.id = ct.tag_id`,
      )
      .get();

    expect({ ...row }).toEqual({
      ...DOCUMENT,
      document_id: documentId,
      ...CHUNK,
      ...TAG,
      chunk_id: chunkId,
      tag_id: tagId,
      ...LINK,
    });
  });

  it('enforces foreign keys', () => {
    const tagId = insertTag(db);

    expect(() => insertLink(db, 999, tagId)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects a duplicate chunk–tag pair', () => {
    const chunkId = insertChunk(db, insertDocument(db));
    const tagId = insertTag(db);
    insertLink(db, chunkId, tagId);

    expect(() => insertLink(db, chunkId, tagId)).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a duplicate document identifier and tag slug', () => {
    insertDocument(db);
    insertTag(db);

    expect(() => insertDocument(db)).toThrow(/UNIQUE constraint failed: documents.identifier/);
    expect(() => insertTag(db)).toThrow(/UNIQUE constraint failed: tags.slug/);
  });

  it('rejects a document type other than law or ruling', () => {
    expect(() => insertDocument(db, { type: 'guideline' })).toThrow(/CHECK constraint failed/);
  });

  it('deleting a document deletes its chunks and their tag links', () => {
    const documentId = insertDocument(db);
    insertLink(db, insertChunk(db, documentId), insertTag(db));

    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);

    expect(count(db, 'chunks')).toBe(0);
    expect(count(db, 'chunk_tags')).toBe(0);
    expect(count(db, 'tags')).toBe(1);
  });
});
