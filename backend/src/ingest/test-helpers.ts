import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { rawFilePath, sourceUrl } from './fetch-raw.js';
import { writeManifest, type ManifestEntry } from './manifest.js';
import type { SelectedDocument } from './selection.js';

export const FETCHED_AT = '2026-10-10T08:00:00.000Z';

/** The manifest entry `data:fetch` would write for `document`. */
export function manifestEntry(document: SelectedDocument): ManifestEntry {
  return {
    type: document.type,
    identifier: document.identifier,
    sourceUrl: sourceUrl(document),
    fetchedAt: FETCHED_AT,
    file: rawFilePath(document),
  };
}

/** A temporary raw data directory and migrated database for importer tests. */
export function createImportWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'import-'));
  const rawDir = join(dir, 'raw');
  const db = openDatabase(join(dir, 'test.db'));
  migrate(db);

  /** The raw file path of `entry`, with its directory created. */
  const rawPath = (entry: ManifestEntry) => {
    const path = join(rawDir, entry.file);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  };

  return {
    dir,
    rawDir,
    db,
    writeRaw(entry: ManifestEntry, content: string) {
      writeFileSync(rawPath(entry), content);
    },
    copyFixture(name: string, entry: ManifestEntry) {
      copyFileSync(new URL(`./fixtures/${name}`, import.meta.url), rawPath(entry));
    },
    writeManifest(entries: ManifestEntry[]) {
      writeManifest(rawDir, { documents: entries });
    },
    documents() {
      return db.prepare('SELECT * FROM documents ORDER BY id').all();
    },
    remove() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
