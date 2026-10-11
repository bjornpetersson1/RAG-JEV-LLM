import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.js';
import { migrate } from './migrations.js';

/**
 * A database in a new temporary directory, migrated with the migrations in `migrationsDir` (all of
 * them by default); `remove` closes it and deletes the directory.
 */
export function createTestDatabase(prefix: string, migrationsDir?: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, 'test.db');
  const db = openDatabase(path);
  migrate(db, migrationsDir);
  return {
    dir,
    path,
    db,
    remove() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
