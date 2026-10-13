import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComparisonRow } from './compare.js';
import { appendToReport, COMPARISON_HEADING, comparisonRows } from './compare-report.js';

const ROW: ComparisonRow = {
  retriever: 'bge',
  reranker: 'bge',
  model: 'onnx-community/bge-reranker-v2-m3-ONNX',
  dtype: 'int8',
  candidates: 40,
  before: {
    central: {
      '5': 0.25,
      '8': 0.375,
      '10': 0.5,
      candidates: 0.75,
      precision5: 0.2,
      precision10: 0.1,
    },
    all: { '5': 0.3, '8': 0.4, '10': 0.5, candidates: 0.8, precision5: 0.3, precision10: 0.2 },
  },
  after: {
    central: {
      '5': 0.5,
      '8': 0.625,
      '10': 0.75,
      candidates: 0.75,
      precision5: 0.4,
      precision10: 0.3,
    },
    all: { '5': 0.6, '8': 0.7, '10': 0.8, candidates: 0.8, precision5: 0.6, precision10: 0.5 },
  },
  retrievalMs: { median: 3200.4, p90: 4100 },
  rerankMs: { median: 30123, p90: 41000 },
  queries: 20,
  notes: [],
  failed: false,
};

describe('comparisonRows', () => {
  it('gives one table row per grade with every column, precision before and after', () => {
    expect(comparisonRows([ROW], '2026-10-12')).toEqual([
      '| 2026-10-12 | bge | bge | onnx-community/bge-reranker-v2-m3-ONNX | int8 | 40.0 | central | ' +
        '0.250 | 0.375 | 0.500 | 0.750 | 0.200 | 0.100 | 0.500 | 0.625 | 0.750 | 0.750 | 0.400 | ' +
        '0.300 | 30123 / 41000 | 3200 / 4100 | 20 |  |',
      '| 2026-10-12 | bge | bge | onnx-community/bge-reranker-v2-m3-ONNX | int8 | 40.0 | all | ' +
        '0.300 | 0.400 | 0.500 | 0.800 | 0.300 | 0.200 | 0.600 | 0.700 | 0.800 | 0.800 | 0.600 | ' +
        '0.500 | 30123 / 41000 | 3200 / 4100 | 20 |  |',
    ]);
  });

  it('leaves the after columns empty for the retriever’s own order', () => {
    const [row] = comparisonRows(
      [{ ...ROW, reranker: 'none', after: undefined, rerankMs: undefined }],
      'd',
    );

    expect(row).toContain('| 0.750 | 0.200 | 0.100 | – | – | – | – | – | – | – |');
  });
});

describe('appendToReport', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('adds the section to a report, then appends later runs as rows of the same table', () => {
    dir = mkdtempSync(join(tmpdir(), 'compare-'));
    const path = join(dir, 'report-2026-10-12.md');
    writeFileSync(path, '# Evaluation\n\nE5-3 results.\n');

    appendToReport(path, [ROW], '2026-10-12');
    appendToReport(path, [{ ...ROW, dtype: 'fp32' }], '2026-10-13');

    const text = readFileSync(path, 'utf8');
    expect(text.startsWith('# Evaluation\n\nE5-3 results.\n')).toBe(true);
    expect(text.split(COMPARISON_HEADING)).toHaveLength(2);
    // One line per grade per run.
    const rows = text.split('\n').filter((line) => line.startsWith('| 2026-10-1'));
    expect(rows).toHaveLength(4);
    expect(rows[3]).toContain('| fp32 |');
    expect(text.endsWith(`${rows[3]}\n`)).toBe(true);
  });

  it('creates the report when there is none', () => {
    dir = mkdtempSync(join(tmpdir(), 'compare-'));
    const path = join(dir, 'report-2026-10-12.md');

    appendToReport(path, [ROW], '2026-10-12');

    expect(readFileSync(path, 'utf8')).toContain(
      `# Evaluation 2026-10-12\n\n${COMPARISON_HEADING}`,
    );
  });

  it('adds a table to a comparison section that has none, before the next section', () => {
    dir = mkdtempSync(join(tmpdir(), 'compare-'));
    const path = join(dir, 'report.md');
    writeFileSync(path, `# Evaluation\n\n${COMPARISON_HEADING}\n\nNotes.\n\n## Later\n\nText.\n`);

    appendToReport(path, [ROW], '2026-10-12');

    const text = readFileSync(path, 'utf8');
    expect(text.indexOf('| 2026-10-12 |')).toBeLessThan(text.indexOf('## Later'));
    expect(text.indexOf('| date | retriever |')).toBeGreaterThan(text.indexOf('Notes.'));
  });

  it('leaves a report’s earlier ungraded table alone and adds the graded one beside it', () => {
    dir = mkdtempSync(join(tmpdir(), 'compare-'));
    const path = join(dir, 'report-2026-10-13.md');
    writeFileSync(
      path,
      '# Evaluation\n\n## Retriever and reranker comparison\n\n| a |\n| --- |\n| 1 |\n',
    );

    appendToReport(path, [ROW], '2026-10-13');

    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## Retriever and reranker comparison\n\n| a |\n| --- |\n| 1 |\n\n');
    expect(text).toContain(`${COMPARISON_HEADING}\n`);
  });
});
