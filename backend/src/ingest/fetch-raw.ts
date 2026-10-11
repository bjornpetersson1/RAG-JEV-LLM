import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { describeError } from '../errors.js';
import type { Failure } from './failures.js';
import { writeFileAtomically } from './files.js';
import { collapseWhitespace } from '../text.js';
import { decodeHtmlEntities } from './html.js';
import { readManifest, writeManifest, type ManifestEntry } from './manifest.js';
import type { SelectedDocument } from './selection.js';

const LAW_URL = 'https://rkrattsbaser.gov.se/sfst?bet=';
const RULING_URL = 'https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar/';
const USER_AGENT = 'RAG-JEV-LLM data fetch (https://github.com/bjornpetersson1/RAG-JEV-LLM)';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DELAY_MS = 500;

export interface FetchRawOptions {
  selection: SelectedDocument[];
  rawDir: string;
  /** Fetch documents again even if their raw file exists. */
  force?: boolean;
  fetch?: typeof fetch;
  /** Pause between requests, so the sources are not hammered. */
  delayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface FetchRawResult {
  fetched: string[];
  skipped: string[];
  failed: Failure[];
}

/** URL the document is fetched from, which the manifest records as its source. */
export function sourceUrl(document: SelectedDocument): string {
  return document.type === 'law'
    ? `${LAW_URL}${document.sfsNumber}`
    : `${RULING_URL}${document.publicationId}`;
}

/** Raw file path relative to the raw data directory, e.g. `laws/SFS-1982-80.html`. */
export function rawFilePath(document: SelectedDocument): string {
  const name = document.identifier.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return document.type === 'law' ? `laws/${name}.html` : `rulings/${name}.json`;
}

/**
 * Downloads every selected document into `rawDir` and writes the manifest. A document that fails
 * is reported and the rest are still fetched.
 */
export async function fetchRaw(options: FetchRawOptions): Promise<FetchRawResult> {
  const { selection, rawDir, force = false } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? setTimeout;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? console.log;
  checkDistinctFiles(selection);

  const previous = new Map(
    (readManifest(rawDir)?.documents ?? []).map((entry) => [entry.identifier, entry]),
  );
  // Starts as everything already on disk, so the manifest stays complete if the run is cut short.
  const entries = new Map<string, ManifestEntry>();
  for (const document of selection) {
    const entry = existingEntry(document, rawDir, previous);
    if (entry) entries.set(document.identifier, entry);
  }
  const saveManifest = () => {
    mkdirSync(rawDir, { recursive: true });
    writeManifest(rawDir, {
      documents: selection.flatMap((document) => entries.get(document.identifier) ?? []),
    });
  };

  const result: FetchRawResult = { fetched: [], skipped: [], failed: [] };
  let requests = 0;
  for (const document of selection) {
    const url = sourceUrl(document);
    const existing = entries.get(document.identifier);

    // A file fetched from another URL (e.g. a corrected publication id) is stale.
    if (!force && existing?.sourceUrl === url) {
      result.skipped.push(document.identifier);
      log(`Skipped ${document.identifier}: already fetched`);
      continue;
    }

    if (requests > 0) await sleep(delayMs);
    requests += 1;
    try {
      const content = await download(fetchFn, url, timeoutMs);
      checkContent(document, content);
      const path = join(rawDir, rawFilePath(document));
      mkdirSync(dirname(path), { recursive: true });
      writeFileAtomically(path, content);
      entries.set(document.identifier, {
        ...describeDocument(document),
        fetchedAt: now().toISOString(),
      });
      saveManifest();
      result.fetched.push(document.identifier);
      log(`Fetched ${document.identifier}`);
    } catch (error) {
      // A file from an earlier run stays on disk and keeps its entry.
      const reason = describeError(error);
      result.failed.push({ identifier: document.identifier, reason });
      log(`Failed ${document.identifier}: ${reason}`);
    }
  }

  saveManifest();
  return result;
}

/** Two identifiers that differ only in punctuation would overwrite each other's raw file. */
function checkDistinctFiles(selection: SelectedDocument[]): void {
  const owners = new Map<string, string>();
  for (const document of selection) {
    const file = rawFilePath(document);
    const owner = owners.get(file);
    if (owner) {
      throw new Error(`${owner} and ${document.identifier} would both be stored as ${file}`);
    }
    owners.set(file, document.identifier);
  }
}

function describeDocument(document: SelectedDocument): Omit<ManifestEntry, 'fetchedAt'> {
  return {
    type: document.type,
    identifier: document.identifier,
    sourceUrl: sourceUrl(document),
    file: rawFilePath(document),
  };
}

/**
 * The manifest entry for a raw file already on disk: the earlier entry, or, if the manifest has
 * none (e.g. it was deleted), one dated by the file's modification time.
 */
function existingEntry(
  document: SelectedDocument,
  rawDir: string,
  previous: Map<string, ManifestEntry>,
): ManifestEntry | undefined {
  const file = rawFilePath(document);
  const stats = statSync(join(rawDir, file), { throwIfNoEntry: false });
  if (!stats) return undefined;
  const earlier = previous.get(document.identifier);
  if (earlier?.file === file) return earlier;
  return { ...describeDocument(document), fetchedAt: stats.mtime.toISOString() };
}

async function download(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<string> {
  const response = await fetchFn(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

/** Rejects a response that is not the expected document, e.g. an error or search page. */
function checkContent(document: SelectedDocument, content: string): void {
  if (document.type === 'law') {
    if (
      !collapseWhitespace(decodeHtmlEntities(content)).includes(collapseWhitespace(document.title))
    ) {
      throw new Error(`Page does not contain the law title "${document.title}"`);
    }
    return;
  }
  let record: unknown;
  try {
    record = JSON.parse(content);
  } catch {
    throw new Error('Response is not JSON');
  }
  if (typeof record !== 'object' || record === null) {
    throw new Error('Response is not a JSON object');
  }
  const { id, innehall } = record as { id?: unknown; innehall?: unknown };
  if (id !== document.publicationId) {
    throw new Error(`Record id ${String(id)} is not the requested ${document.publicationId}`);
  }
  if (typeof innehall !== 'string' || innehall.trim() === '') {
    throw new Error('Record has no HTML full text (innehall)');
  }
}
