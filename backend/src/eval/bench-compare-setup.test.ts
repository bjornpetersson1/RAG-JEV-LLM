import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Embedder } from '../embedding/types.js';
import { createRunLog, readRunLog, type RunLog, type RunLogEntry } from '../generation/run-log.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { latencyOf } from '../stats.js';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from '../retrieval/test-helpers.js';
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

  /** The bench setup over an indexed evaluation database, and its first `limit` queries. */
  async function benchSetup(log: RunLog, limit: number, wrap = (embedder: Embedder) => embedder) {
    database = createEvalDatabase();
    const { embedder, embedded } = createFakeEmbedder();
    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    const queries = resolveEvalQueries(evalQueries(), database.db).slice(0, limit);
    const setup = createBenchSetup(
      database.db,
      { ...ENV, DATABASE_PATH: database.path },
      SILENT_LOGGER,
      wrap(embedder),
      log,
    );
    return { ...setup, queries, embedded };
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
    const { flows, warmUp, queries, embedded } = await benchSetup(memoryLog(), 2);
    const indexed = embedded.length;
    await warmUp();
    const [main, reference] = await benchCompare(queries, flows, { runs: 2, draft: true });

    expect(embedded[indexed]).toBe('uppvärmning');
    expect(flows.map(({ configuration }) => configuration)).toEqual([
      'retriever tags · tag index roaring · translator fake fake · reranker llm fake · top 8 · ' +
        'generator fake fake',
      'retriever dense (fake-embedder int8) · reranker llm fake · top 8 · generator fake fake',
    ]);
    expect(flows.map(({ remoteRerank }) => remoteRerank)).toEqual([true, true]);
    expect(main).toMatchObject({ flow: 'main', queries: 2, runs: 2, failures: 0 });
    expect(reference).toMatchObject({ flow: 'reference', queries: 2, drafts: 4, failures: 0 });
    expect(reference.measured).toMatchObject({ judgedCandidates: 3, unknown: 0 });
    expect(reference.measured?.rerank).toBeDefined();
    expect(reference.measured?.relevance.precision).toBeGreaterThanOrEqual(0);
    // The fake translator's tags find nothing here, so the main flow writes no draft, and the
    // reference's drafts have no shared pair to be compared on.
    expect(main).toMatchObject({ drafts: 0, withoutDraft: 4 });
    expect(reference).toMatchObject({ withoutDraft: 0 });
    expect(reference.measured?.sourceAccuracy).toBeNull();
  });

  it('writes every flow run to the run log as a bench run, the flows of a run sharing a runId', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bench-log-'));
    const path = join(dir, 'logs', 'runs.jsonl');
    // `bench:compare -- --runs 2 --limit 1`.
    const { flows, queries } = await benchSetup(
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
    // The reference RAG embeds the instruction; the main flow searches by tags and does not.
    const { flows, queries } = await benchSetup(log, 1, (embedder) => ({
      ...embedder,
      embed: async () => {
        throw new Error('embedder down');
      },
    }));

    const [main, reference] = await benchCompare(queries, flows, { runs: 1, draft: true });

    expect(reference.failures).toBe(1);
    expect(main.failures).toBe(0);
    const failed = log.entries.find(({ flow }) => flow === 'reference');
    expect(failed).toMatchObject({
      source: 'bench',
      error: expect.stringContaining('embedder down'),
    });
    expect(failed?.timings.totalMs).toBeUndefined();
  });

  it('warns and goes on when the run log cannot be written', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bench-log-'));
    const blocked = join(dir, 'file');
    writeFileSync(blocked, '');
    const warnings: string[] = [];
    const log = createRunLog((message) => warnings.push(message), join(blocked, 'runs.jsonl'));
    const { flows, queries } = await benchSetup(log, 1);

    const [main, reference] = await benchCompare(queries, flows, { runs: 2, draft: true });

    expect(main).toMatchObject({ samples: 2, failures: 0 });
    expect(reference).toMatchObject({ samples: 2, failures: 0 });
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain('Could not write the run log');
  });
});
