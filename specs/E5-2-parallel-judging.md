# E5-2 · Parallel judging

- **Issue:** [#16](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/16)
- **Labels:** `E5 JEV`
- **Phase:** 4. Judging and generation
- **Depends on:** E5-1 (#15), E4-1 (#11)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 496 tests (492 backend, 4 frontend) and build exit 0; `db:migrate` applied 0006 on a copy of the real database)

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
   - Only scores from the configured judge are cached: a result that came from the LLM fallback under `jev-with-fallback` is not stored, so the next run asks JEV again (tested). (**superseded by E8-1**: `jev-with-fallback` is now `RERANKER=jev`)
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

- [x] Migration `0006_judge_cache.sql`: table keyed by the key hash and chunk id, with score, judge implementation, model and `created_at`.
- [x] Config: `JUDGE_CONCURRENCY`, `JUDGE_CHUNK_TIMEOUT_MS`, `JUDGE_TOTAL_TIMEOUT_MS`, `JUDGE_CACHE`, validated at startup; `.env.example`.
- [x] Cancellation: the `Judge` takes an optional `AbortSignal`, forwarded to the JEV client.
- [x] `judgeAll` with the pool, timeouts, cache read/write and the result shape, in `src/judge/`.
- [x] Tests per acceptance criterion.

## Decisions

- **Default concurrency 8** (owner): JEV's rate limit is unknown; adjusted in `.env` once E5-1's probe has measured it.
- **Store the score, apply the threshold at read** (owner): E5-3's threshold sweep can reuse cached scores. Departs from the issue's "score, relevant" columns.
- **Fallback results are not cached** (owner): a passing JEV failure must not lock in LLM answers. Consequence: with JEV down, repeated runs call the LLM again.
- **Overall timeout marks the rest `unknown`** (owner): the query still gets the judgements that finished.
- **Cache key** (default): SHA-256 of the normalized instruction, the judge implementation (`jev` or `llm`, the primary for `jev-with-fallback`) and its model (`JEV_MODEL` or the `LLM_JUDGE` model), plus the chunk id. A model change therefore re-judges.
- **Timeout defaults** (default): 30 s per chunk leaves room for JEV's 10 s timeout followed by an LLM fallback; 60 s overall for a query's candidates.
- **`judge(instruction, chunk, signal?)`** (default): the signal cancels JEV calls on timeout; an LLM call cannot be cancelled by the E1-2 client, so its late result is ignored.
- **No new dependency** (default): the pool follows the worker pattern already used by `tagging/tag-chunks.ts`.

- **Builds on E5-1 as merged** (spec update before implementing): E5-1's judges are `ScoringJudge`s, and `createJudge` adds `relevant` from `JUDGE_THRESHOLD`. `judgeAll` applies the same threshold rule to judged and cached scores (superseded in clean code: it takes the unthresholded judge from `createJudging`, see below). The optional signal goes through `Judge`, `ScoringJudge`, the fallback judge and the JEV judge. A cancelled JEV call is rethrown by the fallback judge, so a chunk timeout never starts an LLM call. With `jev-with-fallback` and no JEV key, E5-1 turns the config into `llm`, so the LLM is then the primary judge and its scores are cached. The LLM model in the key is `roleModel(llmConfig, 'judge')` (`fake` for the fake provider).

- **Cache table** (settled while implementing): `judge_cache (key, chunk_id, text_hash, judge, model, score, created_at)` with primary key `(key, chunk_id)`. `chunk_id` is the `Chunk.id` the caller passes, as text. It has no foreign key, so the cache never blocks a re-import. Instead, `text_hash` (SHA-256 of the judged source and text) makes a chunk whose text changed, or whose id was reused, a miss, and the new score replaces the row.
- **API** (settled while implementing):
  - `judgeAll(instruction, chunks, { judging, config, db, logger }, { cache })` in `src/judge/judge-all.ts`, with the cache in `src/judge/cache.ts`.
  - `loadJudgingConfig` reads the four settings and the server validates them at startup.
  - The result's `relevant` holds the relevant `Chunk`s in input order, ready for the generator. One info line per call logs the counts.
- **Timeouts with timers, not `AbortSignal.timeout`** (settled while implementing): plain timers driving `AbortController`s, so fake timers can test them. A chunk's judgement is raced against its signal, so a late LLM answer, which cannot be cancelled, is dropped with its tokens.

- **Clean code**:
  - **One factory for the judge, its cache key and the threshold.** `createJudging(judgeConfig, { llmConfig, logger, fetch })` returns `{ judge, primary, threshold }`; the LLM judge and the model in the key both come from `llmConfig` (code review), and `judgeAll` takes it as `judging`, so the three can never come from different settings. `judgeAll` applies the threshold once, to judged and cached scores alike; it uses the unthresholded `ScoringJudge`.
  - **The cache key is built from the question the judge is asked** (`relevanceQuestion` on the normalized instruction), so a change of wording starts afresh.
  - **Cheaper cache access.** The statements are prepared once per connection (`preparedOnce`), only the current candidates' rows are read (`json_each`), each chunk's text is hashed once, and new scores are written in one transaction after judging. A cached score's `judgedBy` is the primary judge, which the key already implies, so it is not read back.
  - **`collapseWhitespace` moved to `text.ts`** for reuse.
- **Skipped clean-code suggestions**:
  - **Passing a signal into the LLM client so LLM calls can be cancelled.** It changes E1-2's client and its retries; a late LLM answer is dropped instead, with its tokens.
  - **Keying cache rows by text hash instead of chunk id.** Criterion 1 says another chunk misses.
  - **A shared worker pool with `tag-chunks.ts`.** The tagger runs its first chunk alone to warm the prompt cache, and the judge pool stops on the overall timeout; one helper would need both special cases.
  - **Validating that `JUDGE_CHUNK_TIMEOUT_MS` exceeds `JUDGE_TIMEOUT_MS`.** That is a new rule the spec does not ask for; the defaults (10 s and 30 s) leave room for the fallback.

- **Code review fixes**:
  - **A timed-out chunk keeps its pool slot until its call really ends.** An LLM call cannot be cancelled, so starting the next chunk at once would exceed `JUDGE_CONCURRENCY`. The chunk is still recorded as `unknown` at its timeout, and the overall timeout releases every slot.
  - **Cache read and write errors are logged as warnings, not thrown.** An example is a locked database. The judgements are valid without the cache, and the statements are prepared on first use.
  - **A cancelled JEV call is logged at info level ("JEV call cancelled"), not as a failure.** The overall timeout therefore produces one warning, not one error per chunk in flight.
  - **An empty instruction or a duplicate chunk id is rejected before any call, with the cache on or off.**
  - **`ChunkJudgement` is a union on `status`.** `unknown` has a `reason` and no score.
  - **`isRelevant` is the one relevance rule**, used by E5-1's `createJudge` and by `judgeAll`.
- **Not fixed (code review): tokens of LLM calls still running when the overall timeout fires are not in `usage`, and their scores are not cached.** Those calls cannot be cancelled and finish after `judgeAll` has returned. Reporting them would mean waiting for them, which defeats the timeout.

## Open Questions

- None.
