// The evaluation's terminal table and Markdown report (E5-3).

import { escapeCell } from '../reports.js';
import type { ModeScores, RankedScores, SweepRow } from './metrics.js';
import { GRADE_SCOPES } from './queries.js';
import { EVAL_MODES, JUDGE_MODES, type EvalResult, type JudgeMode } from './run.js';

export interface ReportContext {
  /** When the run started. */
  startedAt: Date;
  /** The models and implementations used, e.g. `{ 'query translator': 'claude-code claude-haiku-5-5' }`. */
  settings: Record<string, string>;
}

/** The summary for the terminal: relevance per mode, the sweeps and the recommendations. */
export function formatForTerminal(result: EvalResult): string {
  return [
    `Relevance over ${result.queries.length} queries (macro average):`,
    '',
    `  ${'mode'.padEnd(10)} ${'grade'.padEnd(8)} precision  recall     F1         P@5        P@10`,
    ...EVAL_MODES.flatMap((mode) =>
      GRADE_SCOPES.map(
        (scope) =>
          `  ${mode.padEnd(10)} ${scope.padEnd(8)} ${rankedColumns(result.modes[mode][scope])}`,
      ),
    ),
    ...JUDGE_MODES.flatMap((mode) => [
      '',
      `Threshold sweep for ${mode} (${judgeNote(result, mode)}):`,
      `  threshold  precision  recall     F1`,
      ...result.sweeps[mode].map(
        (row) =>
          `  ${row.threshold.toFixed(1).padEnd(10)} ${scoreColumns(row)}${mark(result, mode, row)}`,
      ),
      `  Recommended threshold: ${result.recommended[mode].threshold.toFixed(1)} (highest F1)`,
    ]),
    ...failureLines(result).map((line) => (line.startsWith('-') ? `  ${line}` : `\n${line}`)),
  ].join('\n');
}

/** The full report: settings, summary, sweeps and one row per query. */
export function formatAsMarkdown(result: EvalResult, context: ReportContext): string {
  return [
    '# Evaluation report',
    '',
    `Run started ${context.startedAt.toISOString()} over ${result.queries.length} queries from \`eval/queries.yaml\`.`,
    '',
    ...Object.entries(context.settings).map(([name, value]) => `- ${name}: \`${value}\``),
    '',
    ...failureLines(result).flatMap((line) => [line, '']),
    '## Relevance per mode',
    '',
    "Macro averages over the queries. Precision is 0 for a query with nothing returned. The three tag modes start from the same tag-search candidates. Grade `central` counts the chunks the clause rests on, `all` every graded chunk; P@K is relevant chunks among the first K divided by K, in the retriever's order for `tags` and `fts` and the judge's score order for the judge modes.",
    '',
    '| Mode | Grade | Precision | Recall | F1 | P@5 | P@10 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...EVAL_MODES.flatMap((mode) =>
      GRADE_SCOPES.map(
        (scope) => `| ${mode} | ${scope} | ${rankedCells(result.modes[mode][scope])} |`,
      ),
    ),
    '',
    '## Judges',
    '',
    ...JUDGE_MODES.map((mode) => `- **${mode}**: ${judgeNote(result, mode)}.`),
    ...JUDGE_MODES.flatMap((mode) => [
      '',
      `## Threshold sweep: ${mode}`,
      '',
      `Recommended threshold: **${result.recommended[mode].threshold.toFixed(1)}** (highest F1, the lowest threshold on a tie). The sweep reuses the judge's scores; it makes no new calls.`,
      '',
      '| Threshold | Precision | Recall | F1 |',
      '| --- | --- | --- | --- |',
      ...result.sweeps[mode].map((row) => `| ${row.threshold.toFixed(1)} | ${scoreCells(row)} |`),
    ]),
    '',
    '## Per query',
    '',
    'Precision / recall per mode against every graded chunk; "returned" counts what each mode returned.',
    '',
    `| Query | Kind | Template | Tags | Relevant | ${EVAL_MODES.join(' | ')} |`,
    `| --- | --- | --- | --- | --- | ${EVAL_MODES.map(() => '---').join(' | ')} |`,
    ...result.queries.map(
      ({ query, tags, returned, relevance }) =>
        `| ${escapeCell(query.id)} | ${query.kind} | ${query.template ?? '–'} | ${tags.length} | ${query.relevantIds.size} | ` +
        EVAL_MODES.map(
          (mode) =>
            `${formatScore(relevance[mode].all.precision)} / ${formatScore(relevance[mode].all.recall)} (${returned[mode].length})`,
        ).join(' | ') +
        ' |',
    ),
    '',
  ].join('\n');
}

/** A heading and one line per query that could not be evaluated; none when all were. */
function failureLines({ failed }: EvalResult): string[] {
  if (failed.length === 0) return [];
  return [
    `${failed.length} ${failed.length === 1 ? 'query' : 'queries'} failed (left out of every average):`,
    ...failed.map(({ id, error }) => `- ${id}: ${error}`),
  ];
}

/** Which judge was configured and which actually answered, e.g. when the LLM stood in for JEV. */
function judgeNote(result: EvalResult, mode: JudgeMode): string {
  const { name, model } = result.judges[mode];
  const { jev, llm } = result.answeredBy[mode];
  const configured = `configured judge ${name} (${model})`;
  if (mode === 'tags+jev' && name === 'llm') {
    return `${configured}: no JEV_API_KEY, so the LLM answered all ${llm} judgements instead of JEV`;
  }
  return `${configured}; answered by JEV ${jev}, by the LLM ${llm}`;
}

function mark(result: EvalResult, mode: JudgeMode, row: SweepRow): string {
  return row === result.recommended[mode] ? '  <- recommended' : '';
}

function scoreColumns(scores: ModeScores): string {
  return columns([scores.precision, scores.recall, scores.f1]);
}

function scoreCells(scores: ModeScores): string {
  return cells([scores.precision, scores.recall, scores.f1]);
}

function rankedColumns(scores: RankedScores): string {
  return columns(rankedValues(scores));
}

function rankedCells(scores: RankedScores): string {
  return cells(rankedValues(scores));
}

function rankedValues(scores: RankedScores): number[] {
  return [scores.precision, scores.recall, scores.f1, scores.precision5, scores.precision10];
}

function columns(values: readonly number[]): string {
  return values
    .map((value) => formatScore(value).padEnd(10))
    .join(' ')
    .trimEnd();
}

function cells(values: readonly number[]): string {
  return values.map(formatScore).join(' | ');
}

export function formatScore(value: number): string {
  return value.toFixed(3);
}
