import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describeError } from '../errors.js';
import { upsertDocument, type DocumentRow } from './documents.js';
import { requireManifest, type ManifestEntry } from './manifest.js';

export interface ImportOptions {
  db: DatabaseSync;
  rawDir: string;
  log?: (message: string) => void;
}

export interface ImportResult {
  inserted: string[];
  updated: string[];
  failed: { identifier: string; reason: string }[];
}

/** What a parser makes of one raw file: the row (the manifest supplies its source) and a log line. */
export interface ParsedDocument {
  row: Omit<DocumentRow, 'identifier' | 'sourceUrl' | 'fetchedAt'>;
  summary: string;
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
  const result: ImportResult = { inserted: [], updated: [], failed: [] };

  for (const entry of requireManifest(rawDir).documents) {
    if (entry.type !== type) continue;
    try {
      const { row, summary } = parse(readFileSync(join(rawDir, entry.file), 'utf8'), entry);
      const outcome = upsertDocument(db, {
        ...row,
        identifier: entry.identifier,
        sourceUrl: entry.sourceUrl,
        fetchedAt: entry.fetchedAt,
      });
      result[outcome].push(entry.identifier);
      log(`${outcome === 'inserted' ? 'Inserted' : 'Updated'} ${entry.identifier}: ${summary}`);
    } catch (error) {
      const reason = describeError(error);
      result.failed.push({ identifier: entry.identifier, reason });
      log(`Failed ${entry.identifier}: ${reason}`);
    }
  }
  return result;
}
