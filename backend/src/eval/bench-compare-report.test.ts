import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlowSummary } from './bench-compare.js';
import { appendBenchToReport, benchRows } from './bench-compare-report.js';
import { COMPARISON_HEADING } from './compare-report.js';

const MAIN: FlowSummary = {
  flow: 'main',
  configuration: 'retriever tags · reranker bge',
  measured: {
    total: { median: 41_234.4, p90: 52_000 },
    translation: { median: 800, p90: 900 },
    sources: { median: 30_002, p90: 36_005 },
    search: { median: 2, p90: 5 },
    rerank: { median: 30_000, p90: 36_000 },
    generation: { median: 11_000, p90: 15_000 },
    generationPerToken: { median: 9.2, p90: 11 },
    outputTokens: { median: 1200, p90: 1400 },
    llm: { median: 12_000, p90: 16_000 },
    relevance: { precision: 0.4, recall: 0.25 },
    sourceAccuracy: 0.95,
  },
  samples: 100,
  queries: 20,
  drafts: 100,
  runs: 5,
  failures: 0,
};

const REFERENCE: FlowSummary = {
  ...MAIN,
  flow: 'reference',
  configuration: 'dense Xenova/bge-m3 int8',
  measured: {
    total: { median: 35_000, p90: 40_000 },
    sources: { median: 410, p90: 500 },
    search: { median: 410, p90: 500 },
    embedding: { median: 400, p90: 480 },
    llm: { median: 12_000, p90: 16_000 },
    relevance: { precision: 0.3, recall: 0.2 },
    sourceAccuracy: null,
  },
  drafts: 0,
};

describe('benchRows', () => {
  it('gives one row per flow, with – for steps that did not run', () => {
    expect(benchRows([MAIN, REFERENCE], '2026-10-12')).toEqual([
      '| 2026-10-12 | main | retriever tags · reranker bge | 41234 / 52000 | 800 / 900 | 30002 / 36005 | 2 / 5 | – | ' +
        '30000 / 36000 | 11000 / 15000 | 9.2 / 11.0 | 1200 / 1400 | 12000 / 16000 | 0.400 | 0.250 | 0.950 | 100 | 20 | 100 | 5 | 0 |',
      '| 2026-10-12 | reference | dense Xenova/bge-m3 int8 | 35000 / 40000 | – | 410 / 500 | 410 / 500 | 400 / 480 | ' +
        '– | – | – | – | 12000 / 16000 | 0.300 | 0.200 | – | 100 | 20 | 0 | 5 | 0 |',
    ]);
  });

  it('shows – for every measure of a flow that was never measured', () => {
    const [row] = benchRows([{ ...MAIN, measured: undefined, samples: 0, failures: 20 }], 'd');

    expect(row).toBe(
      '| d | main | retriever tags · reranker bge | – | – | – | – | – | – | – | – | – | – | – | – | – | 0 | 20 | 100 | 5 | 20 |',
    );
  });
});

describe('appendBenchToReport', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('adds its own section next to the retriever comparison, then appends rows to it', () => {
    dir = mkdtempSync(join(tmpdir(), 'bench-report-'));
    const path = join(dir, 'report.md');
    writeFileSync(
      path,
      `# Evaluation 2026-10-12\n\n${COMPARISON_HEADING}\n\n| a |\n| --- |\n| 1 |\n`,
    );

    appendBenchToReport(path, [MAIN], '2026-10-12');
    appendBenchToReport(path, [REFERENCE], '2026-10-13');

    const report = readFileSync(path, 'utf8');
    expect(report).toContain(
      `${COMPARISON_HEADING}\n\n| a |\n| --- |\n| 1 |\n\n## Main flow vs reference RAG: time to sources`,
    );
    const rows = report.split('\n').filter((line) => /^\| 2026-10-1[23] \|/.test(line));
    expect(rows).toEqual([
      expect.stringContaining('| 2026-10-12 | main |'),
      expect.stringContaining('| 2026-10-13 | reference |'),
    ]);
  });
});
