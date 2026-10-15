// The evaluation's terminal table and Markdown report (E5-3).

import { escapeCell } from '../reports.js';
import { apiKeyName, PROVIDER_NAMES, type SystemOneProvider } from '../systemone/config.js';
import type { ModeScores, RankedScores, SweepRow } from './metrics.js';
import { GRADE_SCOPES } from './queries.js';
import {
  DOCUMENT_TYPES,
  EVAL_MODES,
  JUDGE_MODES,
  SCORE_BANDS,
  type EvalResult,
  type JudgeMode,
} from './run.js';

/** The System One model a judge mode is for; `tags+llm` has none. */
const MODE_PROVIDERS: Record<JudgeMode, SystemOneProvider | undefined> = {
  'tags+jev': 'jev',
  'tags+subq': 'subq',
  'tags+llm': undefined,
};

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
      `  threshold  ${GRADE_SCOPES.map((scope) => `${scope} P/R/F1`.padEnd(SCOPE_WIDTH)).join('')}`.trimEnd(),
      ...sweepRows(result, mode).map(
        ({ threshold, scopes, central }) =>
          `  ${threshold.toFixed(1).padEnd(10)} ${scopes
            .map((row) => scoreColumns(row).padEnd(SCOPE_WIDTH))
            .join('')
            .trimEnd()}${mark(result, mode, central)}`,
      ),
      `  Recommended threshold: ${result.recommended[mode].threshold.toFixed(1)} (highest central F1)`,
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
    '## Relevance per document type',
    '',
    'The same measures counting only the returned and relevant chunks from laws (`law`) or from rulings (`ruling`), averaged over the queries with at least one relevant chunk of that type in that grade.',
    '',
    '| Mode | Type | Grade | Queries | Precision | Recall | F1 | P@5 | P@10 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...EVAL_MODES.flatMap((mode) =>
      DOCUMENT_TYPES.flatMap((type) =>
        GRADE_SCOPES.map((scope) => {
          const scores = result.modesByType[mode][type][scope];
          return `| ${mode} | ${type} | ${scope} | ${scores.queries} | ${rankedCells(scores)} |`;
        }),
      ),
    ),
    '',
    '## Judges',
    '',
    ...JUDGE_MODES.map((mode) => `- **${mode}**: ${judgeNote(result, mode)}.`),
    '',
    '### Approvals and scores',
    '',
    `"None approved" counts the queries where the judge approved none of the candidates at its configured threshold. The bands are the share of the judge's scores from 0.0–0.1 up to 0.9–1.0.`,
    '',
    `| Mode | None approved | ${bandLabels().join(' | ')} |`,
    `|${' --- |'.repeat(2 + SCORE_BANDS)}`,
    ...JUDGE_MODES.map(
      (mode) =>
        `| ${mode} | ${result.noneApproved[mode]} | ${result.scoreDistribution[mode].map((share) => share.toFixed(2)).join(' | ')} |`,
    ),
    ...JUDGE_MODES.flatMap((mode) => [
      '',
      `## Threshold sweep: ${mode}`,
      '',
      `Recommended threshold: **${result.recommended[mode].threshold.toFixed(1)}** (highest F1 on the central chunks, the lowest threshold on a tie). Each query keeps at most ${result.topK} chunks, best first, as the query flow does (\`RERANK_TOP_K\`). The sweep reuses the judge's scores; it makes no new calls.`,
      '',
      `| Threshold | ${GRADE_SCOPES.flatMap((scope) => ['P', 'R', 'F1'].map((measure) => `${scope} ${measure}`)).join(' | ')} |`,
      `|${' --- |'.repeat(1 + 3 * GRADE_SCOPES.length)}`,
      ...sweepRows(result, mode).map(
        ({ threshold, scopes }) =>
          `| ${threshold.toFixed(1)} | ${scopes.map((row) => scoreCells(row)).join(' | ')} |`,
      ),
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

/**
 * Which judge was configured and which actually answered, e.g. when the LLM stood in for JEV or
 * SubQ.
 */
function judgeNote(result: EvalResult, mode: JudgeMode): string {
  const { name, model } = result.judges[mode];
  const answered = result.answeredBy[mode];
  const configured = `configured judge ${name} (${model})`;
  const provider = MODE_PROVIDERS[mode];
  if (!provider) return `${configured}; answered by the LLM ${answered.llm}`;
  const providerName = PROVIDER_NAMES[provider];
  if (name === 'llm') {
    return `${configured}: no ${apiKeyName(provider)}, so the LLM answered all ${answered.llm} judgements instead of ${providerName}`;
  }
  return `${configured}; answered by ${providerName} ${answered[provider]}, by the LLM ${answered.llm}`;
}

/** `0.0–0.1`, … `0.9–1.0`. */
function bandLabels(): string[] {
  return Array.from(
    { length: SCORE_BANDS },
    (_, i) => `${(i / SCORE_BANDS).toFixed(1)}–${((i + 1) / SCORE_BANDS).toFixed(1)}`,
  );
}

/** A grade scope's three score columns and the gap after them, in the terminal sweep. */
const SCOPE_WIDTH = 33;

/** The sweep per threshold: each grade scope's row side by side, and the central row, which is recommended. */
function sweepRows(result: EvalResult, mode: JudgeMode) {
  const sweeps = result.sweeps[mode];
  return sweeps.central.map((central, i) => ({
    threshold: central.threshold,
    scopes: GRADE_SCOPES.map((scope) => sweeps[scope][i]),
    central,
  }));
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
