import { renameSync, rmSync, writeFileSync } from 'node:fs';

/** Writes through a temporary file, so an interrupted write never leaves a half-written file. */
export function writeFileAtomically(path: string, content: string): void {
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
