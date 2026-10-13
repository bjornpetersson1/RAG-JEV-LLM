// Precision, recall and the judge threshold sweep for the evaluation (E5-3).

import { mean } from '../stats.js';

export interface Relevance {
  precision: number;
  recall: number;
}

export interface ModeScores extends Relevance {
  /** The harmonic mean of the averaged precision and recall. */
  f1: number;
}

/** Precision and recall of a whole list, and precision of its first 5 and 10 (E7-4). */
export interface RankedRelevance extends Relevance {
  precision5: number;
  precision10: number;
}

export type RankedScores = ModeScores & RankedRelevance;

/** Precision and recall of `returned`, best first, and precision at 5 and 10. */
export function rankedRelevance(
  returned: readonly string[],
  relevant: ReadonlySet<string>,
): RankedRelevance {
  return {
    ...precisionRecall(returned, relevant),
    precision5: precisionAt(returned, relevant, 5),
    precision10: precisionAt(returned, relevant, 10),
  };
}

/** Macro averages of the ranked measures; F1 from the averaged precision and recall. */
export function averageRanked(rows: readonly RankedRelevance[]): RankedScores {
  return {
    ...averageOver(rows),
    precision5: mean(rows.map((row) => row.precision5)),
    precision10: mean(rows.map((row) => row.precision10)),
  };
}

export interface SweepRow extends ModeScores {
  threshold: number;
}

/** 0.1, 0.2, … 0.9. */
export const SWEEP_THRESHOLDS = Array.from({ length: 9 }, (_, i) => (i + 1) / 10);

/**
 * Precision = relevant returned / returned (0 when nothing is returned); recall = relevant
 * returned / relevant marked.
 */
export function precisionRecall(
  returned: readonly string[],
  relevant: ReadonlySet<string>,
): Relevance {
  const hits = returned.filter((id) => relevant.has(id)).length;
  return {
    precision: returned.length === 0 ? 0 : hits / returned.length,
    recall: relevant.size === 0 ? 0 : hits / relevant.size,
  };
}

/** Every query weighs the same (macro average). */
export function averageOver(rows: readonly Relevance[]): ModeScores {
  const precision = mean(rows.map((row) => row.precision));
  const recall = mean(rows.map((row) => row.recall));
  return { precision, recall, f1: f1(precision, recall) };
}

export interface ChunkScore {
  chunkId: string;
  score: number;
}

export interface ScoredQuery {
  /** The judge's score per judged chunk; unknown chunks are left out. */
  scores: readonly ChunkScore[];
  relevant: ReadonlySet<string>;
}

/** Precision, recall and F1 when each threshold decides relevance, from the scores already given. */
export function sweepThresholds(queries: readonly ScoredQuery[]): SweepRow[] {
  return SWEEP_THRESHOLDS.map((threshold) => ({
    threshold,
    ...averageOver(
      queries.map(({ scores, relevant }) =>
        precisionRecall(
          scores.filter(({ score }) => score >= threshold).map(({ chunkId }) => chunkId),
          relevant,
        ),
      ),
    ),
  }));
}

/** The row with the highest F1, the lowest threshold on a tie. */
export function recommendThreshold(rows: readonly SweepRow[]): SweepRow {
  return rows.reduce((best, row) => (row.f1 > best.f1 ? row : best));
}

function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** The share of the relevant chunks among the first `k` returned; 0 when nothing is relevant. */
export function recallAt(
  returned: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (relevant.size === 0) return 0;
  return returned.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size;
}

/**
 * Relevant chunks among the first `k` returned, divided by `k`, so returning fewer than `k` is not
 * rewarded.
 */
export function precisionAt(
  returned: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  return returned.slice(0, k).filter((id) => relevant.has(id)).length / k;
}
