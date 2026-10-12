// `npm run eval:label -- <query id> [--chars <n>]`, `npm run eval:run` (E5-3) and
// `npm run bench:compare` (E5-4).

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/with-database.js';
import { parsePositiveInteger } from '../env.js';
import { describeError } from '../errors.js';
import { createConsoleLogger } from '../llm/console-logger.js';
import { localDate, writeMarkdownReport } from '../reports.js';
import { REPO_ROOT } from '../repo-root.js';
import { REPORTS_DIR } from '../tagging/paths.js';
import { formatCandidates, labelCandidates } from './label.js';
import { readEvalQueries, resolveEvalQueries } from './queries.js';
import { formatAsMarkdown, formatForTerminal } from './report.js';
import { runEvaluation, type QueryOutcome } from './run.js';
import { createEvalSetup, createSearchSetup } from './setup.js';
import { RERANKERS } from '../rerank/factory.js';
import { loadRetrievalConfig } from '../retrieval/config.js';
import { compareRerankers } from './compare.js';
import { parseRunArgs, type RunArgs } from './compare-args.js';
import { appendToReport, comparisonTable } from './compare-report.js';
import { createCompareSetup } from './compare-setup.js';
import { benchCompare } from './bench-compare.js';
import { parseBenchArgs, type BenchArgs } from './bench-compare-args.js';
import { appendBenchToReport, benchTable } from './bench-compare-report.js';
import { createBenchSetup } from './bench-compare-setup.js';
import { formatSeconds } from '../models/bench-args.js';

const EVAL_QUERIES_PATH = join(REPO_ROOT, 'eval', 'queries.yaml');
const DEFAULT_TEXT_CHARS = 300;
const USAGE =
  'Usage: eval <label <query id> [--chars <n>] | run [--reranker <names> [--retriever <names>]] | ' +
  'bench [--runs <n>] [--limit <n>] [--no-draft]>';

// Every call and search logs at info level; only problems are worth showing during a long run.
const problemLogger = createConsoleLogger({ quiet: true });

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'run') {
    const compare = parseRunArgs(rest, Object.keys(RERANKERS));
    return compare ? runComparison(compare) : runEval();
  }
  if (command === 'bench') return runBench(parseBenchArgs(rest));
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

/**
 * `run --reranker …`: the retrievers and rerankers compared on the evaluation set (E8-5), printed
 * and appended to `eval/report-<date>.md`.
 */
function runComparison({ rerankers, retrievers }: RunArgs): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    const resolved = resolveEvalQueries(queries, db);
    const setup = createCompareSetup(db, process.env, problemLogger, {
      rerankers,
      retrievers: retrievers ?? [loadRetrievalConfig(process.env).retriever],
    });
    const rows = await compareRerankers(resolved, {
      ...setup,
      onQuery: (query, index, total) => console.log(`[${index + 1}/${total}] ${query.id}`),
      onFailure: (step, query, error) => console.error(`${query.id}: ${step} failed: ${error}`),
    });
    const date = localDate();
    const path = join(REPO_ROOT, 'eval', `report-${date}.md`);
    appendToReport(path, rows, date);
    console.log(`\n${comparisonTable(rows, date)}\n\nAppended to ${path}`);
    return rows.some((row) => row.failed) ? 1 : 0;
  });
}

/**
 * `bench`: the main flow and the reference RAG over the evaluation queries (E5-4), printed and
 * appended to `eval/report-<date>.md`.
 */
function runBench({ runs, limit, draft }: BenchArgs): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    // The whole set is checked first; --limit only picks the queries to run.
    const resolved = resolveEvalQueries(queries, db).slice(0, limit);
    const { flows, warmUp } = createBenchSetup(db, process.env, problemLogger);
    await warmUp();
    const summaries = await benchCompare(resolved, flows, {
      runs,
      draft,
      onResult: ({ flow, query, run, index, result }) =>
        console.log(
          `[run ${run + 1}/${runs}] [${index + 1}/${resolved.length}] ${query.id} ${flow}: ` +
            `${formatSeconds(result.timings.totalMs, 1)}, ${result.approved.length} chunks`,
        ),
      onFailure: ({ flow, query, run, error }) =>
        console.error(`[run ${run + 1}/${runs}] ${query.id} ${flow} failed: ${error}`),
    });
    const date = localDate();
    const path = join(REPO_ROOT, 'eval', `report-${date}.md`);
    appendBenchToReport(path, summaries, date);
    console.log(`\n${benchTable(summaries, date)}\n\nAppended to ${path}`);
    return summaries.some((summary) => summary.failures > 0) ? 1 : 0;
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
