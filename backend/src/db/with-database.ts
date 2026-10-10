import type { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from './config.js';
import { openDatabase } from './database.js';
import { migrate } from './migrations.js';

/**
 * Opens the database at `DATABASE_PATH`, applies pending migrations, runs `work` and closes the
 * database, for CLI commands that read or write it.
 */
export async function withDatabase<T>(work: (db: DatabaseSync) => T | Promise<T>): Promise<T> {
  const db = openDatabase(resolveDatabasePath(process.env.DATABASE_PATH));
  try {
    migrate(db);
    return await work(db);
  } finally {
    db.close();
  }
}
