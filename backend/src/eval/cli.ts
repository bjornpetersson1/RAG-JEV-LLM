// `npm run eval:label -- <query id> [--chars <n>]`, `npm run eval:run` (E5-3) and
// `npm run bench:compare` (E5-4).

import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/with-database.js';
import { parsePositiveInteger } from '../env.js';
import { describeError } from '../errors.js';
import { rejectRemovedSettings } from '../removed-settings.js';
import { createConsoleLogger } from '../llm/console-logger.js';
import { localDate, writeMarkdownReport } from '../reports.js';
import { REPO_ROOT } from '../repo-root.js';
import { REPORTS_DIR, VOCABULARY_PATH } from '../tagging/paths.js';
import { createLabelReferenceSearch, formatCandidates, labelCandidates } from './label.js';
import { readEvalQueries, resolveEvalQueries, type ResolvedQuery } from './queries.js';
import { formatAsMarkdown, formatForTerminal, formatScore } from './report.js';
import { runEvaluation, type QueryOutcome } from './run.js';
import { createEvalSetup, createSearchSetup } from './setup.js';
import { RERANKERS } from '../rerank/factory.js';
import { compareRerankers } from './compare.js';
import { parseRunArgs, type RunArgs } from './compare-args.js';
import { appendToReport, comparisonTable } from './compare-report.js';
import { createCompareSetup, LATENCY_QUERIES } from './compare-setup.js';
import { benchCompare } from './bench-compare.js';
import { parseBenchArgs, type BenchArgs } from './bench-compare-args.js';
import { appendBenchToReport, benchTable } from './bench-compare-report.js';
import { createBenchSetup } from './bench-compare-setup.js';
import { chooseSetting, sweepCandidates } from './sweep.js';
import { appendSweepToReport, sweepTable } from './sweep-report.js';
import { createSweepSetup, SWEEP_BASELINES } from './sweep-setup.js';
import { loadVocabulary } from '../tagging/vocabulary.js';
import { formatUsage, meterSubqUsage } from '../systemone/paid-run.js';
import {
  benchWork,
  compareWork,
  confirmSubqRun,
  evalWork,
  maxJudgedChars,
  sweepWork,
  type SubqWork,
} from './subq-estimate.js';

const EVAL_QUERIES_PATH = join(REPO_ROOT, 'eval', 'queries.yaml');
const DEFAULT_TEXT_CHARS = 300;
const USAGE =
  'Usage: eval <label <query id> [--chars <n>] | run [--reranker <names> | ' +
  '--sweep] [--yes] | ' +
  'bench [--runs <n>] [--limit <n>] [--no-draft] [--yes]>';

// Every call and search logs at info level; only problems are worth showing during a long run. The
// meter counts what SubQ reports, so a run can say what it cost.
const meter = meterSubqUsage(createConsoleLogger({ quiet: true }));
const problemLogger = meter.logger;

try {
  rejectRemovedSettings(process.env);
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  // Also after a failure: the calls made until then are billed.
  printSubqUsage();
}

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  // `--yes` goes on with a run that calls the paid SubQ API without asking (E9-1).
  const yes = rest.includes('--yes');
  const options = rest.filter((arg) => arg !== '--yes');
  if (command === 'run') {
    const runArgs = parseRunArgs(options, Object.keys(RERANKERS));
    if (!runArgs) return runEval(yes);
    return 'sweep' in runArgs ? runSweep(yes) : runComparison(runArgs, yes);
  }
  if (command === 'bench') return runBench(parseBenchArgs(options), yes);
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
    const reference = createLabelReferenceSearch(db, process.env);
    console.log(
      formatCandidates(query, await labelCandidates(query, { ...setup, reference }, db), textChars),
    );
    return 0;
  });
}

function runEval(yes: boolean): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    const resolved = resolveEvalQueries(queries, db);
    if (!(await confirmSubq(db, evalWork(process.env), resolved, yes))) return 1;
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
 * `run --reranker …`: the rerankers compared on the evaluation set (E8-5), printed and appended to
 * `eval/report-<date>.md`.
 */
function runComparison({ rerankers }: RunArgs, yes: boolean): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    const resolved = resolveEvalQueries(queries, db);
    const work = compareWork(process.env, rerankers, LATENCY_QUERIES);
    if (!(await confirmSubq(db, work, resolved, yes))) return 1;
    const setup = createCompareSetup(db, process.env, problemLogger, rerankers);
    const rows = await compareRerankers(resolved, {
      ...setup,
      onQuery: (query, index, total) => console.log(`[${index + 1}/${total}] ${query.id}`),
      onFailure: (step, query, error) => console.error(`${query.id}: ${step} failed: ${error}`),
    });
    const date = localDate();
    const path = reportPath(date);
    appendToReport(path, rows, date);
    console.log(`\n${comparisonTable(rows, date)}\n\nAppended to ${path}`);
    return rows.some((row) => row.failed) ? 1 : 0;
  });
}

/**
 * `bench`: the main flow and the reference RAG over the evaluation queries (E5-4), printed and
 * appended to `eval/report-<date>.md`.
 */
function runBench({ runs, limit, draft }: BenchArgs, yes: boolean): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    // The whole set is checked first; --limit only picks the queries to run.
    const resolved = resolveEvalQueries(queries, db).slice(0, limit);
    const work = benchWork(process.env, runs);
    if (!(await confirmSubq(db, work, resolved, yes))) return 1;
    const flows = createBenchSetup(db, process.env, problemLogger);
    const summaries = await benchCompare(resolved, flows, {
      runs,
      draft,
      onResult: ({ flow, query, run, index, result }) =>
        console.log(
          `[run ${run + 1}/${runs}] [${index + 1}/${resolved.length}] ${query.id} ${flow}: ` +
            `${(result.timings.totalMs / 1000).toFixed(1)} s, ${result.approved.length} chunks`,
        ),
      onFailure: ({ flow, query, run, error }) =>
        console.error(`[run ${run + 1}/${runs}] ${query.id} ${flow} failed: ${error}`),
    });
    const date = localDate();
    const path = reportPath(date);
    appendBenchToReport(path, summaries, date);
    console.log(`\n${benchTable(summaries, date)}\n\nAppended to ${path}`);
    return summaries.some((summary) => summary.failures > 0) ? 1 : 0;
  });
}

/**
 * `run --sweep`: candidate counts and top-k with the configured reranker (E7-4), printed with the
 * setting the rule chooses per retriever and appended to `eval/report-<date>.md`.
 */
function runSweep(yes: boolean): Promise<number> {
  const queries = readEvalQueries(EVAL_QUERIES_PATH);
  return withDatabase(async (db) => {
    const resolved = resolveEvalQueries(queries, db);
    const work = sweepWork(process.env);
    if (!(await confirmSubq(db, work, resolved, yes))) return 1;
    const setup = createSweepSetup(db, process.env, problemLogger);
    let failures = 0;
    const rows = await sweepCandidates(resolved, {
      ...setup,
      onQuery: (query, index, total) => console.log(`[${index + 1}/${total}] ${query.id}`),
      onFailure: (step, query, error) => {
        failures += 1;
        console.error(`${query.id}: ${step} failed: ${error}`);
      },
    });
    const choices = chooseSetting(rows, SWEEP_BASELINES);
    const date = localDate();
    const path = reportPath(date);
    appendSweepToReport(path, rows, choices, setup.reranker.name, date);
    console.log(`\n${sweepTable(rows, choices, setup.reranker.name, date)}\n`);
    for (const { retriever, baseline, chosen } of choices) {
      console.log(
        `${retriever}: chosen ${chosen.candidates} candidates, top ${chosen.topK} ` +
          `(central F1 ${formatScore(chosen.scores.central.f1)} against ${formatScore(baseline.scores.central.f1)})`,
      );
    }
    console.log(`\nAppended to ${path}`);
    return failures > 0 ? 1 : 0;
  });
}

function printProgress(
  { query, tags, returned, unknown }: QueryOutcome,
  index: number,
  total: number,
): void {
  console.log(
    `[${index + 1}/${total}] ${query.id}: ${tags.length} tags, ${returned.tags.length} tag candidates, ` +
      `approved jev ${returned['tags+jev'].length} / subq ${returned['tags+subq'].length} / ` +
      `llm ${returned['tags+llm'].length}, ${returned.fts.length} full-text candidates` +
      (unknown['tags+jev'] + unknown['tags+subq'] + unknown['tags+llm'] > 0
        ? `, unknown ${unknown['tags+jev']} / ${unknown['tags+subq']} / ${unknown['tags+llm']}`
        : ''),
  );
}

/** Whether a run doing `work` may go on; asks first when it calls SubQ (E9-1). */
function confirmSubq(
  db: DatabaseSync,
  work: SubqWork,
  queries: readonly ResolvedQuery[],
  yes: boolean,
): Promise<boolean> {
  return confirmSubqRun(
    work,
    () => ({
      instructions: queries.map((query) => query.instruction),
      vocabulary: loadVocabulary(VOCABULARY_PATH).tags,
      maxJudgedChars: maxJudgedChars(db),
    }),
    { yes },
  );
}

/** What SubQ reported using, when the run called it. */
function printSubqUsage(): void {
  const used = meter.used();
  if (used.calls > 0) console.log(formatUsage(used));
}

/** That day's evaluation report, which the comparison, the benchmark and the sweep append to. */
function reportPath(date: string): string {
  return join(REPO_ROOT, 'eval', `report-${date}.md`);
}
