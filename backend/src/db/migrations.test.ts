import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { migrate, migrationLabel, readMigrations } from './migrations.js';

const SCHEMA_TABLES = ['chunk_tags', 'chunks', 'documents', 'schema_migrations', 'tags'];

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

function recordedVersions(db: DatabaseSync) {
  return db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
    .all();
}

describe('migrate', () => {
  const tempDirs: string[] = [];
  const openDbs: DatabaseSync[] = [];
  const freshDatabase = () => {
    const db = openDatabase(':memory:');
    openDbs.push(db);
    return db;
  };
  const makeMigrationsDir = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    tempDirs.push(dir);
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    return dir;
  };

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the schema on an empty database and records the migration', () => {
    const db = freshDatabase();

    const applied = migrate(db);

    expect(applied.map(migrationLabel)).toEqual(['1_initial']);
    expect(tableNames(db)).toEqual(SCHEMA_TABLES);
    expect(recordedVersions(db)).toEqual([
      { version: 1, name: 'initial', applied_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    ]);
  });

  it('is idempotent: a second run applies nothing and changes nothing', () => {
    const db = freshDatabase();
    migrate(db);
    const tablesBefore = tableNames(db);
    const versionsBefore = recordedVersions(db);

    expect(migrate(db)).toEqual([]);
    expect(tableNames(db)).toEqual(tablesBefore);
    expect(recordedVersions(db)).toEqual(versionsBefore);
  });

  it('applies only new migrations, in version order', () => {
    const db = freshDatabase();
    const dir = makeMigrationsDir({ '0001_first.sql': 'CREATE TABLE a (id INTEGER);' });
    migrate(db, dir);
    writeFileSync(join(dir, '0003_third.sql'), 'CREATE TABLE c (id INTEGER);');
    writeFileSync(join(dir, '0002_second.sql'), 'CREATE TABLE b (id INTEGER);');

    expect(migrate(db, dir).map((m) => m.name)).toEqual(['second', 'third']);
  });

  it('rolls back a failing migration and names it', () => {
    const db = freshDatabase();
    const dir = makeMigrationsDir({
      '0001_broken.sql': 'CREATE TABLE half (id INTEGER); NOT VALID SQL;',
    });

    expect(() => migrate(db, dir)).toThrow('Migration 1_broken failed');
    expect(tableNames(db)).toEqual(['schema_migrations']);
    expect(recordedVersions(db)).toEqual([]);
  });

  it('rolls back a migration that breaks a foreign key and names the table', () => {
    const db = freshDatabase();
    const dir = makeMigrationsDir({
      '0001_tables.sql':
        'CREATE TABLE parent (id INTEGER PRIMARY KEY);' +
        'CREATE TABLE child (parent_id INTEGER REFERENCES parent (id) ON DELETE CASCADE);',
    });
    migrate(db, dir);
    writeFileSync(join(dir, '0002_orphan.sql'), 'INSERT INTO child VALUES (42);');

    expect(() => migrate(db, dir)).toThrow(
      expect.objectContaining({
        message: 'Migration 2_orphan failed',
        cause: expect.objectContaining({ message: 'Foreign key violation in table child' }),
      }),
    );
    expect(db.prepare('SELECT count(*) AS n FROM child').get()).toEqual({ n: 0 });
  });

  it('rebuilds a parent table without cascading to its children, then re-enables foreign keys', () => {
    const db = freshDatabase();
    const dir = makeMigrationsDir({
      '0001_tables.sql':
        'CREATE TABLE parent (id INTEGER PRIMARY KEY);' +
        'CREATE TABLE child (parent_id INTEGER REFERENCES parent (id) ON DELETE CASCADE);' +
        'INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1);',
      '0002_rebuild_parent.sql':
        'CREATE TABLE parent_new (id INTEGER PRIMARY KEY, note TEXT);' +
        'INSERT INTO parent_new (id) SELECT id FROM parent;' +
        'DROP TABLE parent; ALTER TABLE parent_new RENAME TO parent;',
    });

    migrate(db, dir);

    expect(db.prepare('SELECT count(*) AS n FROM child').get()).toEqual({ n: 1 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('reports the failing migration even when it ended the transaction itself', () => {
    const db = freshDatabase();
    const dir = makeMigrationsDir({ '0001_early_commit.sql': 'COMMIT; NOT VALID SQL;' });

    expect(() => migrate(db, dir)).toThrow('Migration 1_early_commit failed');
  });

  it('rejects badly named and duplicate migration files', () => {
    expect(() => readMigrations(makeMigrationsDir({ 'init.sql': '' }))).toThrow(
      'Migration file "init.sql" must be named NNNN_name.sql',
    );
    expect(() => readMigrations(makeMigrationsDir({ '0001_a.sql': '', '0001_b.sql': '' }))).toThrow(
      'Two migrations share version 1',
    );
  });
});
