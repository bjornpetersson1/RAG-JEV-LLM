import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

// backend/migrations, reached from both src/db and dist/db.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** How a migration is named in output and errors, e.g. `1_initial`. */
export function migrationLabel(migration: Migration): string {
  return `${migration.version}_${migration.name}`;
}

/** The `NNNN_name.sql` files in `dir`, in version order. */
export function readMigrations(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match) throw new Error(`Migration file "${file}" must be named NNNN_name.sql`);
      return {
        version: Number(match[1]),
        name: match[2],
        sql: readFileSync(join(dir, file), 'utf8'),
      };
    })
    .sort((a, b) => a.version - b.version);

  const duplicate = migrations.find(
    (migration, i) => migrations[i - 1]?.version === migration.version,
  );
  if (duplicate) throw new Error(`Two migrations share version ${duplicate.version}`);
  return migrations;
}

/** Applies every migration not yet recorded, each in its own transaction; returns those applied. */
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS_DIR): Migration[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  // Foreign keys are off while migrating, because SQLite ignores the pragma inside a transaction
  // and a table rebuild (create, copy, drop, rename) would otherwise cascade-delete child rows.
  // Integrity is checked before each commit instead.
  const applied: Migration[] = [];
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const migration of readMigrations(dir)) {
      // IMMEDIATE takes the write lock before the check, so a concurrent run waits and then skips.
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!isApplied.get(migration.version)) {
          db.exec(migration.sql);
          assertForeignKeysHold(db);
          record.run(migration.version, migration.name, new Date().toISOString());
          applied.push(migration);
        }
        db.exec('COMMIT');
      } catch (error) {
        // SQLite may already have rolled back, e.g. after a full disk.
        if (db.isTransaction) db.exec('ROLLBACK');
        throw new Error(`Migration ${migrationLabel(migration)} failed`, { cause: error });
      }
    }
    return applied;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function assertForeignKeysHold(db: DatabaseSync): void {
  const violation = db.prepare('PRAGMA foreign_key_check').get();
  if (violation) {
    throw new Error(`Foreign key violation in table ${String(violation.table)}`);
  }
}
