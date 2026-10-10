import { resolveDatabasePath } from '../db/config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { describeError } from '../errors.js';
import { fetchRaw } from './fetch-raw.js';
import type { ImportOptions, ImportResult } from './import-documents.js';
import { importLaws } from './import-laws.js';
import { RAW_DATA_DIR, SELECTION_PATH } from './paths.js';
import { loadSelection } from './selection.js';

const USAGE = 'Usage: data <fetch [--force] | import:laws>';

const [command, ...flags] = process.argv.slice(2);

try {
  process.exitCode = await run();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(): Promise<number> {
  if (command === 'fetch' && flags.every((flag) => flag === '--force')) {
    return runFetch(flags.includes('--force'));
  }
  if (command === 'import:laws' && flags.length === 0) {
    return runImport((options) => importLaws({ ...options, today: localDate() }));
  }
  console.error(USAGE);
  return 1;
}

async function runFetch(force: boolean): Promise<number> {
  const started = Date.now();
  const result = await fetchRaw({
    selection: loadSelection(SELECTION_PATH),
    rawDir: RAW_DATA_DIR,
    force,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Fetched ${result.fetched.length}, skipped ${result.skipped.length}, failed ${result.failed.length} in ${seconds} s (${RAW_DATA_DIR})`,
  );
  return reportFailures(result.failed);
}

/** Opens the database, applies pending migrations and runs `importer` over the raw files. */
function runImport(importer: (options: ImportOptions) => ImportResult): number {
  const db = openDatabase(resolveDatabasePath(process.env.DATABASE_PATH));
  try {
    migrate(db);
    const result = importer({ db, rawDir: RAW_DATA_DIR });
    console.log(summarize(result));
    return reportFailures(result.failed);
  } finally {
    db.close();
  }
}

function summarize(result: ImportResult): string {
  return `Inserted ${result.inserted.length}, updated ${result.updated.length}, failed ${result.failed.length}`;
}

function reportFailures(failed: { identifier: string }[]): number {
  if (failed.length === 0) return 0;
  console.error(`Failed: ${failed.map((failure) => failure.identifier).join(', ')}`);
  return 1;
}

/** Today's date in the local time zone as `YYYY-MM-DD`. */
function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
