import { describeError } from '../errors.js';
import { fetchRaw } from './fetch-raw.js';
import { RAW_DATA_DIR, SELECTION_PATH } from './paths.js';
import { loadSelection } from './selection.js';

const USAGE = 'Usage: data fetch [--force]';

const [command, ...flags] = process.argv.slice(2);
if (command !== 'fetch' || flags.some((flag) => flag !== '--force')) {
  console.error(USAGE);
  process.exit(1);
}

try {
  process.exitCode = await runFetch(flags.includes('--force'));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
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
  if (result.failed.length === 0) return 0;
  console.error(`Failed: ${result.failed.map((failure) => failure.identifier).join(', ')}`);
  return 1;
}
