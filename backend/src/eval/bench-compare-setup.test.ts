import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunLog, readRunLog, type RunLog, type RunLogEntry } from '../generation/run-log.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { latencyOf } from '../stats.js';
import { benchCompare } from './bench-compare.js';
import { createBenchSetup } from './bench-compare-setup.js';
import { resolveEvalQueries } from './queries.js';
import { createEvalDatabase, evalQueries } from './test-helpers.js';

describe('createBenchSetup', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;
  let dir: string | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A run log that keeps its entries in memory. */
  function memoryLog(): RunLog & { entries: RunLogEntry[] } {
    const entries: RunLogEntry[] = [];
    return { entries, append: (entry) => entries.push(entry) };
  }

  /**
   * The bench setup over the evaluation database, and its first `limit` queries, each asking for
   * `instruction`: by default words BM25 finds in two chunks, and no vocabulary tag.
   */
  function benchSetup(
    log: RunLog,
    limit: number,
    instruction = 'sakligt grundad oskälig',
    prepare: (db: ReturnType<typeof createEvalDatabase>['db']) => void = () => {},
  ) {
    database = createEvalDatabase();
    prepare(database.db);
    const queries = resolveEvalQueries(evalQueries(), database.db)
      .slice(0, limit)
      .map((query) => ({ ...query, instruction }));
    const flows = createBenchSetup(
      database.db,
      { ...ENV, DATABASE_PATH: database.path },
      SILENT_LOGGER,
      log,
    );
    return { flows, queries, db: database.db };
  }

  const ENV = {
    LLM_PROVIDER: 'fake',
    QUERY_TRANSLATOR_IMPL: 'llm',
    RERANKER: 'llm',
    MAX_CANDIDATES: '3',
    MIN_TAG_CANDIDATES: '1',
    // Every chunk the fake judge scores is relevant, so both flows draft.
    JUDGE_THRESHOLD: '0',
  };

  it('runs the main flow and the reference RAG from .env and measures both', async () => {
    const { flows, queries } = benchSetup(memoryLog(), 2);
    const [main, reference] = await benchCompare(queries, flows, { runs: 2, draft: true });

    expect(flows.map(({ configuration }) => configuration)).toEqual([
      'retriever tags · tag index roaring · translator fake fake · reranker llm fake · top 8 · ' +
        'generator fake fake',
      'retriever bm25 · reranker llm fake · top 8 · generator fake fake',
    ]);
    expect(flows.map(({ remoteRerank }) => remoteRerank)).toEqual([true, true]);
    expect(main).toMatchObject({ flow: 'main', queries: 2, runs: 2, failures: 0 });
    expect(reference).toMatchObject({ flow: 'reference', queries: 2, drafts: 4, failures: 0 });
    expect(reference.measured).toMatchObject({ judgedCandidates: 2, unknown: 0 });
    expect(reference.measured?.rerank).toBeDefined();
    expect(reference.measured?.relevance.precision).toBeGreaterThanOrEqual(0);
    // The fake translator finds no tag, so the main flow's full-text fallback finds what BM25
    // finds: both flows draft every time, and the drafts are compared on every pair.
    expect(main).toMatchObject({ drafts: 4, withoutDraft: 0 });
    expect(reference).toMatchObject({ withoutDraft: 0 });
    expect(reference.measured?.sourceAccuracy).toBe(1);
  });

  it('writes every flow run to the run log as a bench run, the flows of a run sharing a runId', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bench-log-'));
    const path = join(dir, 'logs', 'runs.jsonl');
    // `bench:compare -- --runs 2 --limit 1`.
    const { flows, queries } = benchSetup(
      createRunLog(() => {}, path),
      1,
    );

    const [main, reference] = await benchCompare(queries, flows, { runs: 2, draft: true });

    const entries = await readRunLog(path);
    expect(entries).toHaveLength(4);
    expect(entries.every(({ source }) => source === 'bench')).toBe(true);
    const runIds = [...new Set(entries.map(({ runId }) => runId))];
    expect(runIds).toHaveLength(2);
    for (const [run, runId] of runIds.entries()) {
      const pair = entries.filter((entry) => entry.runId === runId);
      expect(pair.map(({ flow }) => flow).sort()).toEqual(['main', 'reference']);
      const bench = { queryId: queries[0].id, run: run + 1, runs: 2 };
      expect(pair.map((entry) => entry.bench)).toEqual([bench, bench]);
    }
    const [query] = queries;
    expect(entries[0]).toMatchObject({ template: query.kind, instruction: query.instruction });
    // What the report row is built from is what was logged.
    const referenceEntries = entries.filter(({ flow }) => flow === 'reference');
    expect(reference.measured?.total).toEqual(
      latencyOf(referenceEntries.map(({ timings }) => timings.totalMs ?? NaN)),
    );
    expect(referenceEntries.every(({ counts, judging }) => counts && judging)).toBe(true);
    expect(main).toMatchObject({ samples: 2, failures: 0 });
    expect(reference).toMatchObject({ samples: 2, failures: 0 });
  });

  it('logs a failed bench run with its error, and counts it as a failure', async () => {
    const log = memoryLog();
    // The main flow finds a chunk by its tag (the fake translator picks the tag the instruction
    // names), so only the reference RAG needs the full-text index, which is gone.
    const { flows, queries, db } = benchSetup(log, 1, 'Uppsägningstid', (tagged) =>
      tagged.exec(`
        INSERT INTO tags (id, slug, label, description, area) VALUES
          (2, 'uppsagningstid', 'Uppsägningstid', 'uppsägningstid', 'anstallning');
        INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at) VALUES
          (12, 2, 'fake', 'v1', '2026-10-11');
      `),
    );
    db.exec('DROP TABLE chunks_fts');

    const [main, reference] = await benchCompare(queries, flows, { runs: 1, draft: true });

    expect(reference.failures).toBe(1);
    expect(main.failures).toBe(0);
    const failed = log.entries.find(({ flow }) => flow === 'reference');
    expect(failed).toMatchObject({
      source: 'bench',
      error: expect.stringContaining('chunks_fts'),
    });
    expect(failed?.timings.totalMs).toBeUndefined();
  });

  it('warns and goes on when the run log cannot be written', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bench-log-'));
    const blocked = join(dir, 'file');
    writeFileSync(blocked, '');
    const warnings: string[] = [];
    const log = createRunLog((message) => warnings.push(message), join(blocked, 'runs.jsonl'));
    const { flows, queries } = benchSetup(log, 1);

    const [main, reference] = await benchCompare(queries, flows, { runs: 2, draft: true });

    expect(main).toMatchObject({ samples: 2, failures: 0 });
    expect(reference).toMatchObject({ samples: 2, failures: 0 });
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain('Could not write the run log');
  });
});
