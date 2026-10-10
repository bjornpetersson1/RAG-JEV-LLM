import { closeSync, mkdirSync, openSync, readSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Suffixes of the database file and the side files SQLite keeps next to it in WAL mode. */
export const DATABASE_FILE_SUFFIXES = ['', '-wal', '-shm'];

// Every SQLite database file starts with this 16-byte header.
const SQLITE_HEADER = 'SQLite format 3\0';

/** Opens (creating if needed) the database with foreign keys enforced and WAL journaling. */
export function openDatabase(path: string): DatabaseSync {
  let db: DatabaseSync | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    // SQLite opens lazily, so a file that is not a database only fails here.
    // Foreign keys are off unless each connection turns them on.
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    return db;
  } catch (error) {
    db?.close();
    // SQLite's own messages ("unable to open database file") do not say which file.
    throw new Error(`Cannot open database at ${path}`, { cause: error });
  }
}

/**
 * Runs `work` in a transaction that takes the write lock at once, committing on success and rolling
 * back on error.
 */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    // SQLite may already have rolled back, e.g. after a full disk.
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Deletes the database file and SQLite's side files, if they exist. Refuses a file that is not a
 * SQLite database, so a mistyped path cannot delete something else.
 */
export function deleteDatabaseFiles(path: string): void {
  if (!isMissingOrSqlite(path)) {
    throw new Error(`Refusing to delete ${path}: it is not a SQLite database`);
  }
  for (const suffix of DATABASE_FILE_SUFFIXES) rmSync(`${path}${suffix}`, { force: true });
}

function isMissingOrSqlite(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(fd, header, 0, header.length, 0);
    // An empty file is what SQLite leaves when a database was opened but never written.
    return bytesRead === 0 || header.toString('latin1') === SQLITE_HEADER;
  } finally {
    closeSync(fd);
  }
}
