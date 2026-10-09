import { resolveDatabasePath } from './config.js';
import { deleteDatabaseFiles, openDatabase } from './database.js';
import { migrate, migrationLabel } from './migrations.js';

const USAGE = 'Usage: db <migrate|reset>';

const command = process.argv[2];
if (command !== 'migrate' && command !== 'reset') {
  console.error(USAGE);
  process.exit(1);
}

try {
  run(command);
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}

function run(command: 'migrate' | 'reset'): void {
  const path = resolveDatabasePath(process.env.DATABASE_PATH);
  if (command === 'reset') {
    deleteDatabaseFiles(path);
    console.log(`Deleted ${path}`);
  }

  const db = openDatabase(path);
  try {
    const applied = migrate(db);
    console.log(
      applied.length === 0
        ? `${path} is up to date`
        : `Applied to ${path}: ${applied.map(migrationLabel).join(', ')}`,
    );
  } finally {
    db.close();
  }
}

/** The error message followed by its causes, e.g. "Migration 2_x failed: no such table: y". */
function describeError(error: unknown): string {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages.length > 0 ? messages.join(': ') : String(error);
}
