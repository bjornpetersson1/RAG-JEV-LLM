// `npm run eval:label -- <query id> [--chars <n>]` and `npm run eval:run` (E5-3).

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/with-database.js';
import { parsePositiveInteger } from '../env.js';
import { describeError } from '../errors.js';
import type { LlmLogger } from '../llm/client.js';
import { writeMarkdownReport } from '../reports.js';
import { REPO_ROOT } from '../repo-root.js';
import { REPORTS_DIR } from '../tagging/paths.js';
import { formatCandidates, labelCandidates } from './label.js';
import { readEvalQueries, resolveEvalQueries } from './queries.js';
import { formatAsMarkdown, formatForTerminal } from './report.js';
import { runEvaluation, type QueryOutcome } from './run.js';
import { createEvalSetup, createSearchSetup } from './setup.js';

const EVAL_QUERIES_PATH = join(REPO_ROOT, 'eval', 'queries.yaml');
const DEFAULT_TEXT_CHARS = 300;
const USAGE = 'Usage: eval <label <query id> [--chars <n>] | run>';

// Every call and search logs at info level; only problems are worth showing during a long run.
const problemLogger: LlmLogger = {
  info() {},
  warn: (entry, message) => console.warn(`${message} ${JSON.stringify(entry)}`),
  error: (entry, message) => console.error(`${message} ${JSON.stringify(entry)}`),
};

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'run' && rest.length === 0) return runEval();
  if (command === 'label') {
    const label = parseLabelArgs(rest);
    if (label) return runLabel(label.queryId, label.textChars);
  }
  console.error(USAGE);
  return 1;
}

/** `<query id> [--chars <n>]`, or undefined for anything else. */
function parseLabelArgs(args: string[]): { queryId: string; textChars: number } | undefined {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { chars: { type: 'string' } },
      allowPositionals: true,
    });
    const textChars =
      values.chars === undefined ? DEFAULT_TEXT_CHARS : parsePositiveInteger(values.chars);
    if (positionals.length !== 1 || textChars === undefined) return undefined;
    return { queryId: positionals[0], textChars };
  } catch {
    return undefined;
  }
}

function runLabel(queryId: string, textChars: number): Promise<number> {
  const query = readEvalQueries(EVAL_QUERIES_PATH).find((candidate) => candidate.id === queryId);
  if (!query) throw new Error(`No query "${queryId}" in ${EVAL_QUERIES_PATH}`);
  return withDatabase(async (db) => {
    const setup = createSearchSetup(db, process.env, problemLogger);
    console.log(formatCandidates(query, await labelCandidates(query, setup, db), textChars));
    return 0;
  });
}

function runEval(): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    const resolved = resolveEvalQueries(queries, db);
    const setup = createEvalSetup(db, process.env, problemLogger);
    const startedAt = new Date();
    const result = await runEvaluation(resolved, {
      ...setup,
      onQuery: printProgress,
      onFailure: ({ id, error }, index, total) =>
        console.error(`[${index + 1}/${total}] ${id} failed: ${error}`),
    });
    const path = writeMarkdownReport(
      REPORTS_DIR,
      'eval',
      formatAsMarkdown(result, { startedAt, settings: setup.settings }),
    );
    console.log(`\n${formatForTerminal(result)}\n\nReport: ${path}`);
    return result.failed.length === 0 ? 0 : 1;
  });
}

function printProgress(
  { query, tags, returned, unknown }: QueryOutcome,
  index: number,
  total: number,
): void {
  console.log(
    `[${index + 1}/${total}] ${query.id}: ${tags.length} tags, ${returned.tags.length} tag candidates, ` +
      `approved jev ${returned['tags+jev'].length} / llm ${returned['tags+llm'].length}, ` +
      `${returned.fts.length} full-text candidates` +
      (unknown['tags+jev'] + unknown['tags+llm'] > 0
        ? `, unknown ${unknown['tags+jev']} / ${unknown['tags+llm']}`
        : ''),
  );
}
