import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { RunLogEntry } from '../generation/run-log.js';
import { registerRunsRoute, RUNS_PAGE_SIZE } from './runs-route.js';

function entry(overrides: Partial<RunLogEntry>): RunLogEntry {
  return {
    timestamp: '2026-10-13T12:00:00.000Z',
    runId: 'a',
    source: 'api',
    flow: 'main',
    template: 'employment',
    instruction: 'Säljare',
    timings: { searchMs: 1, sourcesMs: 5, totalMs: 9 },
    ...overrides,
  };
}

describe('GET /runs', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runs-route-'));
    path = join(dir, 'runs.jsonl');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeLog(lines: (RunLogEntry | string)[]) {
    writeFileSync(
      path,
      lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'),
    );
  }

  async function get(url: string) {
    const instance = buildApp({ logger: false });
    registerRunsRoute(instance, path);
    const response = await instance.inject({ method: 'GET', url });
    await instance.close();
    return response;
  }

  it('groups the flows of a request, newest request first, and skips broken lines', async () => {
    writeLog([
      entry({ runId: 'a', timestamp: '2026-10-13T10:00:00.000Z' }),
      entry({ runId: 'a', flow: 'reference', timestamp: '2026-10-13T10:01:00.000Z' }),
      'not json',
      JSON.stringify({ flow: 'main', timestamp: '2026-10-13T11:00:00.000Z' }),
      JSON.stringify({ runId: 'c', timestamp: '2026-10-13T11:30:00.000Z' }),
      entry({ runId: 'b', template: 'nda', timestamp: '2026-10-13T12:00:00.000Z' }),
    ]);

    const response = await get('/runs');

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: RUNS_PAGE_SIZE });
    expect(body.requests.map((request: { runId: string }) => request.runId)).toEqual(['b', 'a']);
    expect(body.requests[1].flows.map((flow: RunLogEntry) => flow.flow)).toEqual([
      'main',
      'reference',
    ]);
  });

  it('filters by contract type and by flow', async () => {
    writeLog([
      entry({ runId: 'a' }),
      entry({ runId: 'a', flow: 'reference' }),
      entry({ runId: 'b', template: 'nda', timestamp: '2026-10-13T13:00:00.000Z' }),
    ]);

    const nda = (await get('/runs?template=nda')).json();
    const reference = (await get('/runs?flow=reference')).json();

    expect(nda.requests.map((request: { runId: string }) => request.runId)).toEqual(['b']);
    expect(reference.requests.map((request: { runId: string }) => request.runId)).toEqual(['a']);
  });

  it('returns one page at a time with the total', async () => {
    writeLog(
      Array.from({ length: RUNS_PAGE_SIZE + 3 }, (_, i) =>
        entry({ runId: `r${i}`, timestamp: `2026-10-13T12:00:${String(i).padStart(2, '0')}.000Z` }),
      ),
    );

    const second = (await get('/runs?page=2')).json();

    expect(second.total).toBe(RUNS_PAGE_SIZE + 3);
    expect(second.requests.map((request: { runId: string }) => request.runId)).toEqual([
      'r2',
      'r1',
      'r0',
    ]);
  });

  it('answers an empty list without a log, and 400 for an invalid filter', async () => {
    expect((await get('/runs')).json()).toEqual({
      requests: [],
      total: 0,
      page: 1,
      pageSize: RUNS_PAGE_SIZE,
    });
    expect((await get('/runs?template=lease')).statusCode).toBe(400);
    expect((await get('/runs?flow=other')).statusCode).toBe(400);
    expect((await get('/runs?page=0')).statusCode).toBe(400);
  });
});
