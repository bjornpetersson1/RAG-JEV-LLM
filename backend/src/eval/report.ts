// The evaluation's terminal table and Markdown report (E5-3).

import { escapeCell } from '../reports.js';
import type { ModeScores, SweepRow } from './metrics.js';
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
    `  ${'mode'.padEnd(10)} precision  recall     F1`,
    ...EVAL_MODES.map((mode) => `  ${mode.padEnd(10)} ${scoreColumns(result.modes[mode])}`),
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
    'Macro averages over the queries. Precision is 0 for a query with nothing returned. The three tag modes start from the same tag-search candidates.',
    '',
    '| Mode | Precision | Recall | F1 |',
    '| --- | --- | --- | --- |',
    ...EVAL_MODES.map((mode) => `| ${mode} | ${scoreCells(result.modes[mode])} |`),
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
    'Precision / recall per mode; "returned" counts what each mode returned.',
    '',
    `| Query | Kind | Template | Tags | Relevant | ${EVAL_MODES.join(' | ')} |`,
    `| --- | --- | --- | --- | --- | ${EVAL_MODES.map(() => '---').join(' | ')} |`,
    ...result.queries.map(
      ({ query, tags, returned, relevance }) =>
        `| ${escapeCell(query.id)} | ${query.kind} | ${query.template ?? '–'} | ${tags.length} | ${query.relevantIds.size} | ` +
        EVAL_MODES.map(
          (mode) =>
            `${formatScore(relevance[mode].precision)} / ${formatScore(relevance[mode].recall)} (${returned[mode].length})`,
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
  return [scores.precision, scores.recall, scores.f1]
    .map((value) => formatScore(value).padEnd(10))
    .join(' ')
    .trimEnd();
}

function scoreCells(scores: ModeScores): string {
  return [scores.precision, scores.recall, scores.f1].map(formatScore).join(' | ');
}

export function formatScore(value: number): string {
  return value.toFixed(3);
}
