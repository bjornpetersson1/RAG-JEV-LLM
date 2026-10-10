import { resolve } from 'node:path';
import { REPO_ROOT } from '../repo-root.js';

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
