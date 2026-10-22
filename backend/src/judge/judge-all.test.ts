import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../db/test-helpers.js';
import { loadLlmConfig } from '../llm/config.js';
import { createCapturingLogger, createFakeFetch } from '../llm/test-helpers.js';
import type { Chunk, JudgeScore, ScoringJudge } from '../llm/types.js';
import { loadJudgeConfig, type JudgingConfig } from './config.js';
import { createJudging, type Judging, type PrimaryJudge } from './factory.js';
import { judgeAll } from './judge-all.js';

const CONFIG: JudgingConfig = {
  concurrency: 8,
  chunkTimeoutMs: 1000,
  totalTimeoutMs: 5000,
  cache: true,
};
const LLM: PrimaryJudge = { impl: 'llm', model: 'claude-haiku-5-5' };
const USAGE = { inputTokens: 10, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 };

function chunksNumbered(count: number): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({ id: `c${i + 1}`, text: `Text ${i + 1}` }));
}

/** A judge answering `answer(chunk)` (default 0.7 by the LLM), counting its calls. */
function countingJudge(
  answer: (
    chunk: Chunk,
    signal?: AbortSignal,
  ) => Promise<Partial<JudgeScore>> | Partial<JudgeScore> = () => ({}),
) {
  const calls: string[] = [];
  const judge: ScoringJudge = {
    async judge(_instruction, chunk, signal) {
      calls.push(chunk.id);
      return { score: 0.7, judgedBy: 'llm', usage: USAGE, ...(await answer(chunk, signal)) };
    },
  };
  return { judge, calls };
}

describe('judgeAll', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let logger: ReturnType<typeof createCapturingLogger>;

  beforeEach(() => {
    database = createTestDatabase('judge-all-');
    logger = createCapturingLogger();
  });
  afterEach(() => {
    vi.useRealTimers();
    database.remove();
  });

  function deps({
    judge,
    primary = LLM,
    threshold = 0.5,
    config = CONFIG,
  }: {
    judge: ScoringJudge;
    primary?: PrimaryJudge;
    threshold?: number;
    config?: JudgingConfig;
  }) {
    return withJudging({ judge, primary, threshold }, config);
  }

  function withJudging(judging: Judging, config = CONFIG) {
    return { judging, config, db: database.db, logger };
  }

  const cachedRows = () => database.db.prepare('SELECT COUNT(*) AS n FROM judge_cache').get()?.n;

  describe('cache', () => {
    it('answers a repeated query from the cache without judge calls', async () => {
      const { judge, calls } = countingJudge((chunk) => ({ score: chunk.id === 'c2' ? 0.2 : 0.9 }));
      const chunks = chunksNumbered(3);

      const first = await judgeAll('Anställningsavtal för säljare', chunks, deps({ judge }));
      const second = await judgeAll('Anställningsavtal för säljare', chunks, deps({ judge }));

      expect(calls).toHaveLength(3);
      expect(first).toMatchObject({ cacheHits: 0, judgeCalls: 3 });
      expect(second).toMatchObject({ cacheHits: 3, judgeCalls: 0, usage: { inputTokens: 0 } });
      expect(second.judgements).toMatchObject([
        { status: 'cached', score: 0.9, relevant: true },
        { status: 'cached', score: 0.2, relevant: false },
        { status: 'cached', score: 0.9, relevant: true },
      ]);
    });

    it('makes no new JEV calls for a repeated query', async () => {
      const fake = createFakeFetch(() =>
        Response.json({ answers: { relevant: { type: 'noul', noul: 0.8 } }, usage: {} }),
      );
      const judging = createJudging(loadJudgeConfig({ JEV_API_KEY: 'k' }, 'jev'), {
        llmConfig: loadLlmConfig({ LLM_PROVIDER: 'fake' }),
        logger,
        fetch: fake.fetch,
      });

      await judgeAll('Sekretessavtal', chunksNumbered(4), withJudging(judging));
      await judgeAll('Sekretessavtal', chunksNumbered(4), withJudging(judging));

      expect(fake.fetch).toHaveBeenCalledTimes(4);
    });

    it('shares entries between spellings that differ only in case and whitespace', async () => {
      const { judge, calls } = countingJudge();

      await judgeAll('  Anställningsavtal  för säljare', chunksNumbered(2), deps({ judge }));
      const second = await judgeAll(
        'anställningsavtal för\tsäljare ',
        chunksNumbered(2),
        deps({ judge }),
      );

      expect(calls).toHaveLength(2);
      expect(second.cacheHits).toBe(2);
    });

    it('misses for another judge, model, chunk or chunk text', async () => {
      const { judge, calls } = countingJudge();
      await judgeAll('NDA', chunksNumbered(2), deps({ judge }));

      await judgeAll(
        'NDA',
        chunksNumbered(2),
        deps({ judge, primary: { impl: 'llm', model: 'other' } }),
      );
      await judgeAll(
        'NDA',
        chunksNumbered(2),
        deps({ judge, primary: { impl: 'jev', model: 'claude-haiku-5-5' } }),
      );
      await judgeAll('NDA', [{ id: 'c3', text: 'Text 3' }], deps({ judge }));
      await judgeAll('NDA', [{ id: 'c1', text: 'Changed text' }], deps({ judge }));

      expect(calls).toEqual(['c1', 'c2', 'c1', 'c2', 'c1', 'c2', 'c3', 'c1']);
    });

    it('keeps SubQ scores apart from JEV and LLM scores, even under the same model name', async () => {
      const subq = countingJudge(() => ({ judgedBy: 'subq' }));
      const jev = countingJudge(() => ({ judgedBy: 'jev' }));
      const llm = countingJudge();
      const model = 'same-model';

      await judgeAll(
        'NDA',
        chunksNumbered(2),
        deps({ judge: subq.judge, primary: { impl: 'subq', model } }),
      );
      const again = await judgeAll(
        'NDA',
        chunksNumbered(2),
        deps({ judge: subq.judge, primary: { impl: 'subq', model } }),
      );
      await judgeAll(
        'NDA',
        chunksNumbered(2),
        deps({ judge: jev.judge, primary: { impl: 'jev', model } }),
      );
      await judgeAll(
        'NDA',
        chunksNumbered(2),
        deps({ judge: llm.judge, primary: { impl: 'llm', model } }),
      );

      expect(again.cacheHits).toBe(2);
      expect(subq.calls).toHaveLength(2);
      expect(jev.calls).toHaveLength(2);
      expect(llm.calls).toHaveLength(2);
    });

    it('does not cache an LLM fallback answer when JEV is the primary judge', async () => {
      const { judge, calls } = countingJudge(() => ({ judgedBy: 'llm' }));
      const primary: PrimaryJudge = { impl: 'jev', model: 'jev-latest' };

      await judgeAll('NDA', chunksNumbered(2), deps({ judge, primary }));
      const second = await judgeAll('NDA', chunksNumbered(2), deps({ judge, primary }));

      expect(calls).toHaveLength(4);
      expect(second.cacheHits).toBe(0);
      expect(cachedRows()).toBe(0);
    });

    it('applies the current threshold to cached scores', async () => {
      const { judge, calls } = countingJudge(() => ({ score: 0.6 }));
      await judgeAll('NDA', chunksNumbered(1), deps({ judge }));

      const stricter = await judgeAll('NDA', chunksNumbered(1), deps({ judge, threshold: 0.65 }));

      expect(calls).toHaveLength(1);
      expect(stricter.judgements[0]).toMatchObject({
        status: 'cached',
        score: 0.6,
        relevant: false,
      });
      expect(stricter.relevant).toEqual([]);
    });

    it.each([
      ['JUDGE_CACHE=off', { ...CONFIG, cache: false }, {}],
      ['{ cache: false }', CONFIG, { cache: false }],
    ])('is neither read nor written with %s', async (_case, config, options) => {
      const { judge, calls } = countingJudge();

      await judgeAll('NDA', chunksNumbered(3), deps({ judge, config }), options);
      const second = await judgeAll('NDA', chunksNumbered(3), deps({ judge, config }), options);

      expect(calls).toHaveLength(6);
      expect(second.cacheHits).toBe(0);
      expect(cachedRows()).toBe(0);
    });

    it('is used with { cache: true } when JUDGE_CACHE=off', async () => {
      const { judge, calls } = countingJudge();
      const config = { ...CONFIG, cache: false };

      await judgeAll('NDA', chunksNumbered(2), deps({ judge, config }), { cache: true });
      await judgeAll('NDA', chunksNumbered(2), deps({ judge, config }), { cache: true });

      expect(calls).toHaveLength(2);
    });
  });

  describe('concurrency', () => {
    it('never has more calls in flight than the limit, and cache hits take no slot', async () => {
      let inFlight = 0;
      let peak = 0;
      const { judge } = countingJudge(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return {};
      });
      const config = { ...CONFIG, concurrency: 3 };
      await judgeAll('NDA', chunksNumbered(5), deps({ judge, config }));

      const result = await judgeAll('NDA', chunksNumbered(30), deps({ judge, config }));

      expect(peak).toBe(3);
      expect(result).toMatchObject({ cacheHits: 5, judgeCalls: 25, unknown: 0 });
    });
  });

  describe('timeouts and failures', () => {
    it('keeps a timed-out call in its slot until it really ends, so the limit holds', async () => {
      vi.useFakeTimers();
      const { judge, calls } = countingJudge(async (chunk) => {
        if (chunk.id === 'c1') await new Promise((resolve) => setTimeout(resolve, 3000));
        return {};
      });
      const config = { ...CONFIG, concurrency: 1 };

      const pending = judgeAll('NDA', chunksNumbered(2), deps({ judge, config }));
      await vi.advanceTimersByTimeAsync(2000);
      const callsWhileC1Runs = [...calls];
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(callsWhileC1Runs).toEqual(['c1']);
      expect(calls).toEqual(['c1', 'c2']);
      expect(result.judgements.map((judgement) => judgement.status)).toEqual(['unknown', 'judged']);
    });

    it('marks a chunk that exceeds the per-chunk timeout unknown and logs it', async () => {
      vi.useFakeTimers();
      let cancelled: AbortSignal | undefined;
      const { judge } = countingJudge((chunk, signal) => {
        if (chunk.id !== 'c2') return {};
        cancelled = signal;
        return new Promise(() => {});
      });

      const pending = judgeAll('NDA', chunksNumbered(3), deps({ judge }));
      // The never-ending call holds its slot until the overall timeout releases it.
      await vi.advanceTimersByTimeAsync(CONFIG.totalTimeoutMs);
      const result = await pending;

      expect(result.judgements.map((judgement) => judgement.status)).toEqual([
        'judged',
        'unknown',
        'judged',
      ]);
      expect(result.judgements[1]).toMatchObject({ reason: 'no judgement within 1000 ms' });
      expect(result.relevant.map((chunk) => chunk.id)).toEqual(['c1', 'c3']);
      expect(cancelled?.aborted).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        { role: 'judge', chunkId: 'c2', reason: 'no judgement within 1000 ms' },
        'Chunk could not be judged',
      );
    });

    it('marks a chunk whose judge fails unknown, logs it and does not cache it', async () => {
      const { judge } = countingJudge((chunk) => {
        if (chunk.id === 'c1') throw new Error('JEV and the LLM both failed');
        return {};
      });

      const result = await judgeAll('NDA', chunksNumbered(2), deps({ judge }));

      expect(result.judgements[0]).toEqual({
        chunkId: 'c1',
        status: 'unknown',
        elapsedMs: expect.any(Number),
        reason: 'JEV and the LLM both failed',
      });
      expect(result).toMatchObject({ unknown: 1, judgeCalls: 2 });
      expect(cachedRows()).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { role: 'judge', chunkId: 'c1', reason: 'JEV and the LLM both failed' },
        'Chunk could not be judged',
      );
    });

    it('returns what finished when the overall timeout is reached, the rest unknown', async () => {
      vi.useFakeTimers();
      const signals: AbortSignal[] = [];
      const { judge, calls } = countingJudge(async (_chunk, signal) => {
        signals.push(signal!);
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {};
      });
      const config = { ...CONFIG, concurrency: 1, totalTimeoutMs: 1000 };

      const pending = judgeAll('NDA', chunksNumbered(5), deps({ judge, config }));
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(result.judgements.map((judgement) => judgement.status)).toEqual([
        'judged',
        'judged',
        'unknown',
        'unknown',
        'unknown',
      ]);
      expect(calls).toEqual(['c1', 'c2', 'c3']);
      expect(signals[2].aborted).toBe(true);
      expect(result.unknown).toBe(3);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { role: 'judge', chunks: 3, totalTimeoutMs: 1000 },
        'Judging reached its overall timeout; the chunks not judged are unknown',
      );
    });
  });

  it.each([
    ['on', CONFIG],
    ['off', { ...CONFIG, cache: false }],
  ])(
    'rejects an empty instruction and duplicate chunk ids with the cache %s',
    async (_case, config) => {
      const { judge, calls } = countingJudge();

      await expect(judgeAll('  ', chunksNumbered(2), deps({ judge, config }))).rejects.toThrow(
        'An instruction is required',
      );
      await expect(
        judgeAll(
          'NDA',
          [...chunksNumbered(2), { id: 'c1', text: 'Other' }],
          deps({ judge, config }),
        ),
      ).rejects.toThrow('Chunk "c1" is given twice');
      expect(calls).toEqual([]);
    },
  );

  it('keeps the judgements when the cache cannot be read or written', async () => {
    const { judge, calls } = countingJudge();
    database.db.exec('DROP TABLE judge_cache');

    const result = await judgeAll('NDA', chunksNumbered(2), deps({ judge }));

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ cacheHits: 0, judgeCalls: 2, unknown: 0 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('no such table') }),
      'Judge cache could not be read',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('no such table') }),
      'Judge cache could not be written',
    );
  });

  it('reports per-chunk and total timing, counts and token usage', async () => {
    const { judge } = countingJudge((chunk) => ({
      score: chunk.id === 'c1' ? 0.3 : 0.8,
      judgedBy: 'llm',
    }));
    await judgeAll('NDA', chunksNumbered(1), deps({ judge }));

    const result = await judgeAll('NDA', chunksNumbered(3), deps({ judge }));

    expect(result).toEqual({
      judgements: [
        {
          chunkId: 'c1',
          status: 'cached',
          score: 0.3,
          relevant: false,
          judgedBy: 'llm',
          elapsedMs: 0,
        },
        {
          chunkId: 'c2',
          status: 'judged',
          score: 0.8,
          relevant: true,
          judgedBy: 'llm',
          elapsedMs: expect.any(Number),
        },
        {
          chunkId: 'c3',
          status: 'judged',
          score: 0.8,
          relevant: true,
          judgedBy: 'llm',
          elapsedMs: expect.any(Number),
        },
      ],
      relevant: [
        { id: 'c2', text: 'Text 2' },
        { id: 'c3', text: 'Text 3' },
      ],
      elapsedMs: expect.any(Number),
      cacheHits: 1,
      judgeCalls: 2,
      unknown: 0,
      usage: { inputTokens: 20, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 },
    });
  });
});
