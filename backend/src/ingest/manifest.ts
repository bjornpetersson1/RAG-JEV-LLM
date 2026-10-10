import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomically } from './files.js';
import type { SelectedDocument } from './selection.js';

const MANIFEST_FILE = 'manifest.json';

export interface ManifestEntry {
  type: SelectedDocument['type'];
  identifier: string;
  sourceUrl: string;
  /** ISO 8601 time the raw file was fetched. */
  fetchedAt: string;
  /** Path of the raw file relative to the raw data directory. */
  file: string;
}

export interface Manifest {
  documents: ManifestEntry[];
}

/** The manifest in `rawDir`, or `undefined` when there is none yet. */
export function readManifest(rawDir: string): Manifest | undefined {
  const path = join(rawDir, MANIFEST_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

export function writeManifest(rawDir: string, manifest: Manifest): void {
  writeFileAtomically(join(rawDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}
