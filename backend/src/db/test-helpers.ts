import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.js';
import { migrate } from './migrations.js';

/** A migrated database in a new temporary directory; `remove` closes it and deletes the directory. */
export function createTestDatabase(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const db = openDatabase(join(dir, 'test.db'));
  migrate(db);
  return {
    dir,
    db,
    remove() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
