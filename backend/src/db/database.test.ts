import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_PATH, REPO_ROOT, resolveDatabasePath } from './config.js';
import { DATABASE_FILE_SUFFIXES, deleteDatabaseFiles, openDatabase } from './database.js';

describe('database files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates missing parent directories and enables foreign keys and WAL', () => {
    const path = join(dir, 'nested', 'deeper', 'test.db');

    const db = openDatabase(path);
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get();
    const journalMode = db.prepare('PRAGMA journal_mode').get();
    db.close();

    expect(existsSync(path)).toBe(true);
    expect(foreignKeys).toEqual({ foreign_keys: 1 });
    expect(journalMode).toEqual({ journal_mode: 'wal' });
  });

  it('names the path when the database cannot be opened', () => {
    expect(() => openDatabase(dir)).toThrow(`Cannot open database at ${dir}`);
  });

  it('names the path when the file is not a database', () => {
    const path = join(dir, 'notes.txt');
    writeFileSync(path, 'just some text that is not a SQLite database');

    expect(() => openDatabase(path)).toThrow(`Cannot open database at ${path}`);
  });

  it('deletes the database and its side files', () => {
    const path = join(dir, 'test.db');
    openDatabase(path).close();
    for (const suffix of DATABASE_FILE_SUFFIXES.slice(1)) writeFileSync(`${path}${suffix}`, '');

    deleteDatabaseFiles(path);
    deleteDatabaseFiles(path);

    for (const suffix of DATABASE_FILE_SUFFIXES) expect(existsSync(`${path}${suffix}`)).toBe(false);
  });

  it('refuses to delete a file that is not a SQLite database', () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, '# Not a database');

    expect(() => deleteDatabaseFiles(path)).toThrow(
      `Refusing to delete ${path}: it is not a SQLite database`,
    );
    expect(existsSync(path)).toBe(true);
  });
});

describe('resolveDatabasePath', () => {
  it('defaults to data/rag.db at the repo root', () => {
    expect(resolveDatabasePath(undefined)).toBe(join(REPO_ROOT, DEFAULT_DATABASE_PATH));
    expect(resolveDatabasePath('  ')).toBe(join(REPO_ROOT, DEFAULT_DATABASE_PATH));
  });

  it('rejects the in-memory name, which would become a file in the repo root', () => {
    expect(() => resolveDatabasePath(':memory:')).toThrow('Invalid DATABASE_PATH ":memory:"');
  });

  it('resolves relative paths from the repo root and keeps absolute ones', () => {
    expect(resolveDatabasePath('data/other.db')).toBe(join(REPO_ROOT, 'data', 'other.db'));
    const absolute = join(tmpdir(), 'x.db');
    expect(resolveDatabasePath(absolute)).toBe(absolute);
  });
});
