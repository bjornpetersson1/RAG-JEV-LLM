# E5-2 · Parallel judging

- **Issue:** [#16](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/16)
- **Labels:** `E5 JEV`
- **Phase:** 4. Judging and generation
- **Depends on:** E5-1 (#15), E4-1 (#11)
- **Status:** Approved

## Summary

`judgeAll(instruction, chunks)` judges a query's candidate chunks concurrently through the E5-1 judge, with a concurrency limit, a per-chunk and an overall timeout, and a SQLite cache of scores per instruction and chunk, so a repeated query makes no new judge calls. The cache can be switched off for timing measurements.

## Goals

- `judgeAll` with a concurrency pool, per-chunk timeout and overall timeout.
- A cache table (migration) keyed by the normalized instruction, judge implementation and model, and chunk id, storing the score.
- A cache on/off setting, overridable per call.
- A result with per-chunk outcomes, total judging time, time per chunk and the number of cache hits.
- Chunks that cannot be judged are marked `unknown`, excluded from the relevant set and logged.

## Non-goals

- The judge implementations, threshold and fallback themselves (E5-1).
- Finding the candidates (E4-1/E4-3) and the query flow that calls `judgeAll` (E6).
- Cache expiry or a size limit; the cache is cleared by deleting its rows.
- Retrying chunks that ended `unknown`.
- Calibrating the threshold (E5-3).

## Acceptance Criteria

1. **Running the same query twice makes the second run without new calls (verified by call counter in tests).**
   - With the cache on, a second `judgeAll` with the same instruction and chunks makes zero judge calls and reports every chunk as a cache hit with the same scores; a test counts calls on a fake judge (and on a fake JEV `fetch`).
   - The instruction is normalized before keying (trimmed, lower-cased, whitespace collapsed); a test shows " Anställningsavtal för säljare" and "anställningsavtal för säljare" sharing entries.
   - A different judge implementation or model, or a different chunk, misses the cache.
   - Only scores from the configured judge are cached: a result that came from the LLM fallback under `jev-with-fallback` is not stored, so the next run asks JEV again (tested).
   - Only the score is stored; `relevant` is computed at read against the current `JUDGE_THRESHOLD`, so changing the threshold does not invalidate the cache (tested).
2. **Concurrency never exceeds the configured limit (tested).**
   - `JUDGE_CONCURRENCY` (positive integer, default 8) caps the judge calls in flight. A test with a fake judge that records the peak number of concurrent calls over e.g. 30 chunks and a limit of 3 sees a peak of exactly 3.
   - Cache hits do not take a slot.
3. **Timeouts are respected and logged.**
   - `JUDGE_CHUNK_TIMEOUT_MS` (default 30000) bounds one chunk's judgement, fallback included; `JUDGE_TOTAL_TIMEOUT_MS` (default 60000) bounds the whole `judgeAll`.
   - A chunk that exceeds its timeout, or that fails (both JEV and the fallback, or the single configured judge), is `unknown`; a warning is logged with the chunk id and the reason.
   - When the overall timeout is reached, calls in flight are cancelled and every chunk not yet judged is `unknown`; the results finished so far are returned and one warning is logged with the number of chunks affected.
   - Tests with a fake judge and fake timers cover a per-chunk timeout, a failing chunk and the overall timeout.
4. **Cache can be disabled via config/flag.**
   - `JUDGE_CACHE` (`on` | `off`, default `on`) sets the default; `judgeAll(..., { cache: false })` overrides it per call. With the cache off, nothing is read or written (tested: a repeated run makes the full number of calls and the table stays empty).
5. **The result reports timing and cache use.**
   - Per chunk: the chunk id, `status` (`judged` | `cached` | `unknown`), score and `relevant` (absent for `unknown`), `judgedBy`, and elapsed ms. In total: elapsed ms for the whole call, the number of cache hits, judge calls and `unknown` chunks, and the summed token usage.
   - The relevant chunks are returned in input order.
6. **The migration runs and the tests run offline.**
   - The new migration applies from an empty database and on top of the existing schema (`npm run db:migrate`), tested like the earlier migrations.
   - `npm test` passes without network access.

## Tasks

- [ ] Migration `0006_judge_cache.sql`: table keyed by the key hash and chunk id, with score, judge implementation, model and `created_at`.
- [ ] Config: `JUDGE_CONCURRENCY`, `JUDGE_CHUNK_TIMEOUT_MS`, `JUDGE_TOTAL_TIMEOUT_MS`, `JUDGE_CACHE`, validated at startup; `.env.example`.
- [ ] Cancellation: the `Judge` takes an optional `AbortSignal`, forwarded to the JEV client.
- [ ] `judgeAll` with the pool, timeouts, cache read/write and the result shape, in `src/judge/`.
- [ ] Tests per acceptance criterion.

## Decisions

- **Default concurrency 8** (owner): JEV's rate limit is unknown; adjusted in `.env` once E5-1's probe has measured it.
- **Store the score, apply the threshold at read** (owner): E5-3's threshold sweep can reuse cached scores. Departs from the issue's "score, relevant" columns.
- **Fallback results are not cached** (owner): a passing JEV failure must not lock in LLM answers. Consequence: with JEV down, repeated runs call the LLM again.
- **Overall timeout marks the rest `unknown`** (owner): the query still gets the judgements that finished.
- **Cache key** (default): SHA-256 of the normalized instruction, the judge implementation (`jev` or `llm`, the primary for `jev-with-fallback`) and its model (`JEV_MODEL` or the `LLM_JUDGE` model), plus the chunk id. A model change therefore re-judges.
- **Timeout defaults** (default): 30 s per chunk leaves room for JEV's 10 s timeout followed by an LLM fallback; 60 s overall for a query's candidates.
- **`judge(instruction, chunk, signal?)`** (default): the signal cancels JEV calls on timeout; an LLM call cannot be cancelled by the E1-2 client, so its late result is ignored.
- **No new dependency** (default): the pool follows the worker pattern already used by `tagging/tag-chunks.ts`.

- **Builds on E5-1 as merged** (spec update before implementing): E5-1's judges are `ScoringJudge`s, and `createJudge` adds `relevant` from `JUDGE_THRESHOLD`. `judgeAll` takes the judge `createJudge` builds and also applies the threshold to cached scores. The optional signal goes through `Judge`, `ScoringJudge`, the fallback judge and the JEV judge. A cancelled JEV call is rethrown by the fallback judge, so a chunk timeout never starts an LLM call. With `jev-with-fallback` and no JEV key, E5-1 turns the config into `llm`, so the LLM is then the primary judge and its scores are cached. The LLM model in the key is `roleModel(llmConfig, 'judge')` (`fake` for the fake provider).

## Open Questions

- None.
