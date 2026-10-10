import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { upsertDocument, type DocumentRow } from './documents.js';
import { forEachDocument, type Failure } from './failures.js';
import { requireManifest, type ManifestEntry } from './manifest.js';

export interface ImportOptions {
  db: DatabaseSync;
  rawDir: string;
  log?: (message: string) => void;
}

export interface ImportResult {
  inserted: string[];
  updated: string[];
  failed: Failure[];
  /** Imported, but with warnings worth a look, e.g. a ruling whose sections were not recognised. */
  flagged: string[];
}

/** What a parser makes of one raw file: the row (the manifest supplies its source) and a log line. */
export interface ParsedDocument {
  row: Omit<DocumentRow, 'identifier' | 'sourceUrl' | 'fetchedAt'>;
  summary: string;
  warnings?: string[];
}

/**
 * Imports every manifest entry of `type` into `documents` through `parse`. A document that fails
 * is reported and the rest are still imported.
 */
export function importDocuments(
  options: ImportOptions & {
    type: ManifestEntry['type'];
    parse: (content: string, entry: ManifestEntry) => ParsedDocument;
  },
): ImportResult {
  const { db, rawDir, type, parse } = options;
  const log = options.log ?? console.log;
  const result: ImportResult = { inserted: [], updated: [], failed: [], flagged: [] };
  const entries = requireManifest(rawDir).documents.filter((entry) => entry.type === type);

  result.failed = forEachDocument(
    entries,
    (entry) => entry.identifier,
    (entry) => {
      const {
        row,
        summary,
        warnings = [],
      } = parse(readFileSync(join(rawDir, entry.file), 'utf8'), entry);
      const outcome = upsertDocument(db, {
        ...row,
        identifier: entry.identifier,
        sourceUrl: entry.sourceUrl,
        fetchedAt: entry.fetchedAt,
      });
      result[outcome].push(entry.identifier);
      log(`${outcome === 'inserted' ? 'Inserted' : 'Updated'} ${entry.identifier}: ${summary}`);
      if (warnings.length > 0) {
        result.flagged.push(entry.identifier);
        for (const warning of warnings) log(`Flagged ${entry.identifier}: ${warning}`);
      }
    },
    log,
  );
  return result;
}
