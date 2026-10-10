import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Three levels up from both src/db and dist/db is the repo root.
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const DEFAULT_DATABASE_PATH = 'data/rag.db';

/** Absolute database path from `DATABASE_PATH`; relative values resolve from the repo root. */
export function resolveDatabasePath(value: string | undefined): string {
  const configured = value?.trim() || DEFAULT_DATABASE_PATH;
  // SQLite's in-memory name would otherwise become a file called ":memory:" in the repo root.
  if (configured === ':memory:') {
    throw new Error('Invalid DATABASE_PATH ":memory:": expected a file path');
  }
  return resolve(REPO_ROOT, configured);
}
