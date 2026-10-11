# E5-1 · Judge adapter

- **Issue:** [#15](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/15)
- **Labels:** `E5 JEV`
- **Phase:** 4. Judging and generation
- **Depends on:** E1-2 (#2); builds on the JEV client from E4-4 (#14)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 471 tests (467 backend, 4 frontend) and build exit 0; startup warning and error checked on the built server). JEV itself not called live: no `JEV_API_KEY`, so criterion 5's limits are documented as not measured

## Summary

The `Judge` interface gets its real implementations: a JEV judge that sends a candidate chunk as state with the lawyer's instruction as one Noul question, an LLM judge that answers the same question with a score, and a fallback judge that uses JEV and switches to the LLM when JEV fails. The implementation and the threshold are chosen in `.env`.

## Goals

- `JevJudge` on top of E4-4's JEV client (`backend/src/jev/client.ts`).
- The real Swedish prompt for the LLM judge (replacing E1-2's placeholder).
- `FallbackJudge`: JEV first, the LLM on any JEV error, each fallback logged.
- `JUDGE_IMPL`, `JUDGE_THRESHOLD` and `JUDGE_TIMEOUT_MS` in `.env`, validated at startup.
- A probe script that measures JEV latency and limits once a key exists, and README documentation of what has been observed.

## Non-goals

- Judging many chunks concurrently, the concurrency limit and the cache (E5-2).
- Calibrating the threshold on the evaluation set (E5-3).
- Wiring the judge into a query flow or HTTP route (E5-2, E6).
- Retries against JEV; the fallback replaces them.
- Truncating or splitting chunks for JEV.
- A JEV-based tagger (noted in the issue's comment; a later issue).
- Live JEV measurements: there is no `JEV_API_KEY` yet (see Decisions).

## Acceptance Criteria

1. **Both implementations return relevant/not relevant and a value per chunk.**
   - JEV: the state is the chunk's source reference, a blank line and the chunk text (only the text when there is no source); one Noul question, "Är texten relevant för följande uppdrag: <instruktion>?". The score is JEV's Noul value. A test with a fake `fetch` checks the request body (state, question type and wording) and the result.
   - LLM: a Swedish prompt asks the same question about the same text and gets a score 0–1 as structured JSON; the score is clamped to 0–1, and a wrongly shaped answer is an error. A test with the fake LLM client checks the prompt contents and the result.
   - Both return `{ relevant, score, judgedBy, usage }`, where `judgedBy` is `jev` or `llm`, and `relevant` is `score >= threshold`.
2. **The threshold is configurable.**
   - `JUDGE_THRESHOLD` (0–1, default 0.5) sets the threshold for both implementations; a score exactly at the threshold is relevant. Tests cover a score below, at and above it for both.
   - A value outside 0–1 or not a number fails at startup with a message naming the variable.
3. **The fallback is used if JEV does not respond (tested with a fake failing JEV).**
   - With `JUDGE_IMPL=jev-with-fallback`, any `JevError` except a cancellation (timeout, network, HTTP error including 4xx/429, malformed response) makes the judge ask the LLM instead; the result has `judgedBy: 'llm'`, and a warning is logged with the chunk id and the JEV error's kind and message. Tests cover a timeout, an HTTP 500 and a malformed response with a fake `fetch`.
   - A cancellation is rethrown, not sent to the LLM. If the LLM fails too, its error is thrown.
   - With `JUDGE_IMPL=jev`, a JEV error is thrown; with `JUDGE_IMPL=llm`, JEV is never called.
   - `JUDGE_TIMEOUT_MS` (default 10000) is the JEV timeout for judging; a test shows a JEV call slower than it falling back.
4. **The implementation is chosen in configuration.**
   - `JUDGE_IMPL` is `jev` | `llm` | `jev-with-fallback`, default `jev-with-fallback`.
   - With the default and no `JEV_API_KEY`, startup succeeds, a warning says JEV is not configured, and the LLM judge is used. `JUDGE_IMPL=jev` without `JEV_API_KEY` fails at startup with a clear message. An unknown value fails.
   - The LLM judge uses the E1-2 judge provider and model (`LLM_JUDGE_*`).
   - Tests show the factory building each case from env values alone; `.env.example` documents every new key.
5. **Observed JEV limits are documented in the README.**
   - `npm run jev:probe -w backend` measures, against the real JEV: latency over repeated calls (median and max), the largest state accepted (doubling the state size until JEV rejects it or a cap is reached) and how a burst of concurrent calls is answered (429s seen). Without `JEV_API_KEY` it exits non-zero with a clear message.
   - The README has a "JEV limits" section with what has been observed so far. Until a key exists it says the limits are not yet measured and how to measure them; this criterion is then reported as not verified live.
6. **Tests run without network access.**
   - `npm test` passes with no `ANTHROPIC_API_KEY` or `JEV_API_KEY`.

## Tasks

- [x] Extend `Judgement` with `judgedBy` and `usage`; update the fake judge and callers.
- [x] `JevJudge` (state, Noul question, threshold) in `src/judge/`.
- [x] Swedish prompt for the LLM judge; threshold applied in code.
- [x] `FallbackJudge` with the warning log.
- [x] Config `loadJudgeConfig` (`JUDGE_IMPL`, `JUDGE_THRESHOLD`, `JUDGE_TIMEOUT_MS`) and factory `createJudge`; server startup validation and the missing-key warning.
- [x] `jev:probe` script.
- [x] `.env.example` and README ("JEV limits", judge settings).
- [x] Tests per acceptance criterion.

## Decisions

- **Noul question with the instruction, not the tags** (owner): "Är texten relevant för följande uppdrag: <instruktion>?", as in the requirements and the issue. The `Judge` interface keeps `judge(instruction, chunk)`.
- **State is source reference + chunk text** (owner): gives JEV the law or case the text comes from at little cost.
- **Default `jev-with-fallback`, warn and use the LLM without a key** (owner): the target setup is the default, and the app still runs before a JEV key exists. An explicit `JUDGE_IMPL=jev` without a key is a startup error.
- **Fallback on every JEV error except a cancellation** (owner), no retries against JEV: one judgement must not wait for JEV twice.
- **No truncation** (owner): chunks are at most `CHUNK_MAX_CHARS` (2000 by default, E2-4); if JEV rejects a state as too large, that is a JEV error and the fallback takes over.
- **Limits documented as not measured** (owner): there is no `JEV_API_KEY`; the probe script is ready, and the README states the gap. The JEV request shape is still only verified with a fake `fetch` (as in E4-4).
- **Threshold applied in code for both implementations** (default): the LLM is asked only for a score, so both judges decide `relevant` the same way and E5-3 can calibrate one number. This leaves E5-2 free to cache scores and apply the threshold at read.
- **`judgedBy` and `usage` on `Judgement`** (default): E5-2 needs to know which judge answered (cache key, measurement) and the tokens used.
- **`JUDGE_TIMEOUT_MS`, default 10000** (default): judging is per chunk, so JEV should give up sooner than `JEV_TIMEOUT_MS` (30 s, query translation). The LLM fallback keeps `LLM_TIMEOUT_MS`. The JEV key, base URL and model are shared with E4-4.
- **Code in `backend/src/judge/`** (default), like `src/query/` for E4-4.

- **Code layout** (settled while implementing, reshaped in clean code): `src/judge/` holds `createJevJudge`, `createFallbackJudge`, `loadJudgeConfig` and `createJudge(config, { llmJudge, logger, fetch })`, the same shape as E4-4's `createQueryTranslator`. The LLM judge stays in `llm/roles.ts` beside the other LLM roles; the shared question and state live in `llm/judge-question.ts`, so `judge/` depends on `llm/` and not the other way round.
- **The threshold is applied once, in `createJudge`** (clean code): the JEV, LLM, fake and fallback judges are `ScoringJudge`s returning `{ score, judgedBy, usage }`; `createJudge` adds `relevant = score >= JUDGE_THRESHOLD` to whichever answered, so JEV and its fallback can never use different thresholds. `LlmRoles.judge` is now a `ScoringJudge`, so E1-2's fake judge no longer decides `relevant` itself.
- **`JUDGE_TIMEOUT_MS` replaces `JEV_TIMEOUT_MS` for judging** (clean code): `loadJevConfig` takes an optional timeout that replaces `JEV_TIMEOUT_MS`, which is still validated (code review). `hasJevKey` and `loadJevConfig` share one reading of the key, so "JEV is configured" has one definition (PR review). E1-2's spec marks its `Judge` contract and fake-judge threshold as superseded by this issue (PR review). `MAX_TIMER_MS` lives in `http.ts`, shared with the LLM config; `percentile` moved from `search/bench.ts` to `stats.ts`, shared with the probe.
- **Skipped clean-code suggestions**: a circuit breaker that stops asking JEV after it fails (changes behaviour; E5-2's per-chunk and overall timeouts bound the cost); cancelling a judgement with an `AbortSignal` (E5-2 adds it); logging the missing-key warning from `createJudge` instead of a `warning` field (the server only validates config at startup and does not build the judge yet, and the criterion asks for a startup warning).
- **The LLM judge's answer is `{ score }` only** (settled while implementing): the system prompt asks for the probability that the answer is yes; `relevant` is computed in code. `max_tokens` is 1000.
- **`LlmLogger` gains `warn`** (settled while implementing): the fallback and the missing-key notice are warnings. Fastify's logger already has it; the tagging CLI's console logger and the test logger got one.
- **The probe lives in `src/judge/probe.ts`** (`npm run jev:probe`, also from the repo root): 10 sequential calls, states doubling from 1,000 to at most 256,000 characters, and a burst of 20 concurrent calls. Code review: it uses the judge's timeout (`JUDGE_TIMEOUT_MS`), since it measures what the judge can use; only a 4xx other than 429 counts as JEV refusing a state, while a timeout, rate limit or server error is reported as "not measured"; each probe reports its own failure, so the others still run.
- **The question ends in exactly one "?"** (code review): the instruction's trailing `.`, `?` and `!` are dropped, and an empty instruction is an error. The fake judge fills `judgedBy` and `usage` per field, so an explicit `undefined` cannot leak through.
- **Circuit breaker not added** (code review finding, not fixed): with JEV down, every chunk still tries JEV before the LLM. Remembering the failure would change the approved behaviour ("JEV first, LLM on any JEV error"); E5-2's concurrency and overall timeout bound the cost, and the per-chunk warnings show the outage. Left for after JEV's real behaviour has been measured.

## Open Questions

- None.
