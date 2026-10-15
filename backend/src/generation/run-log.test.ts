import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { createRunLog, runAndLog, type RunLogEntry } from './run-log.js';
import { createQueryFlow } from './setup.js';

/** A logged run with the fields every entry has. */
function entry(runId: string): RunLogEntry {
  return {
    timestamp: '2026-10-13T12:00:00.000Z',
    runId,
    source: 'cli',
    flow: 'main',
    template: 'nda',
    instruction: 'Säljare',
    timings: { searchMs: 1, totalMs: 2 },
  };
}

describe('createRunLog', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('appends one JSON line per entry, creating the folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'run-log-'));
    const path = join(dir, 'logs', 'runs.jsonl');
    const log = createRunLog(() => {}, path);

    log.append(entry('1'));
    log.append(entry('2'));

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).runId)).toEqual(['1', '2']);
  });

  it('warns instead of failing when it cannot write', () => {
    dir = mkdtempSync(join(tmpdir(), 'run-log-'));
    const blocked = join(dir, 'file');
    writeFileSync(blocked, '');
    const warnings: string[] = [];

    createRunLog((message) => warnings.push(message), join(blocked, 'runs.jsonl')).append(
      entry('1'),
    );

    expect(warnings).toEqual([expect.stringContaining('Could not write the run log')]);
  });
});

describe('runAndLog from the command line', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('logs the run with its configuration, timings, counts and judging', async () => {
    const { db, path } = (database = createEvalDatabase());
    const flow = createQueryFlow(
      db,
      { LLM_PROVIDER: 'fake', RERANKER: 'llm', JUDGE_CACHE: 'off', DATABASE_PATH: path },
      SILENT_LOGGER,
    );
    const logged: RunLogEntry[] = [];

    const result = await runAndLog(
      { instruction: 'Uppsägning ska vara sakligt grundad', template: 'employment' },
      flow,
      { log: { append: (entry) => logged.push(entry) }, source: 'cli', runId: 'r1' },
    );

    expect(logged).toEqual([
      {
        timestamp: expect.any(String),
        runId: 'r1',
        source: 'cli',
        flow: 'main',
        template: 'employment',
        instruction: 'Uppsägning ska vara sakligt grundad',
        configuration: flow.configuration,
        timings: result.timings,
        counts: expect.objectContaining({ candidates: result.candidates }),
        judging: result.judging,
        sourceAccuracy: result.draft?.check?.sourceAccuracy,
      },
    ]);
    expect(logged[0].timings.sourcesMs).toBe(
      result.timings.searchMs + (result.timings.judgingMs ?? 0),
    );
    expect(flow.configuration).toMatchObject({
      retriever: 'tags',
      tagIndex: 'roaring',
      reranker: 'llm fake',
      generator: 'fake fake',
      topK: 8,
    });
  });
});
