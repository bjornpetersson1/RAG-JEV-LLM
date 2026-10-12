# E8-1 · Reranker and Embedder interfaces

- **Issue:** [#65](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/65)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E5-1 (#15), E5-2 (#16)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 651 tests (647 backend, 4 frontend) and build exit 0; startup errors for `RERANKER=foo`, `JUDGE_IMPL` and `RERANKER=jev` without a key checked on the built server; `npm run query` with fake roles and `RERANKER=llm` on the real database)

## Summary

The relevance step moves behind one `Reranker` interface, chosen in `.env` with `RERANKER=bge|jev|llm|qwen3`, and an `Embedder` interface is added for E8-2 and E8-4. JEV and today's LLM judge become rerankers with unchanged behaviour, so the local BGE models from E8-2/E8-3 can be demoed now and JEV switched in once credits can be bought.

## Goals

- A `Reranker` interface with a `ScoredChunk` result that is the same for every implementation.
- An `Embedder` interface for queries and passages, with a dense vector and an optional sparse part.
- One factory reading `RERANKER` and `EMBEDDER`; no other code branches on the implementation.
- `JevReranker` and `LlmReranker` on top of the existing JEV client, JEV judge, fallback judge, LLM judge and `judgeAll` (concurrency, timeouts, cache).
- Placeholders `BgeReranker`, `Qwen3Reranker` and `BgeEmbedder` that are registered and throw "not implemented". (**superseded by E8-2/E8-3**: `BgeEmbedder` and `BgeReranker` are implemented; only `qwen3` is a placeholder)
- The query flow and `eval:run` call the `Reranker` instead of the judge.
- `RERANKER` and `RERANK_TOP_K` documented in `.env.example`, replacing `JUDGE_IMPL`.

## Non-goals

- Implementing BGE: the embedder is E8-2, the reranker E8-3.
- Implementing Qwen3: a placeholder only.
- Embedding chunks, storing vectors or retrieving by vector (E8-4).
- `eval:run --reranker` and comparing rerankers (E8-5).
- Changing the JEV client or the Noul question, or calling JEV live (no key).
- Changing the judge cache's table or key, or caching anything other than `jev` and `llm`.
- Changing the generator's limits (`GENERATOR_MAX_CHUNKS`, `GENERATOR_MAX_CONTEXT_CHARS`).
- Re-tuning `JUDGE_THRESHOLD` (#58).

## Acceptance Criteria

1. **`RERANKER=jev`, `RERANKER=llm` and `RERANKER=bge` are selected in `.env` only, and an unknown value fails at startup with a clear message.**
   - The config loader accepts `bge`, `jev`, `llm` and `qwen3`; the default is `llm` (see Decisions).
   - An unknown value (e.g. `RERANKER=foo`) makes the server's startup config fail with a message naming `RERANKER` and the allowed values; covered by a config test.
   - A set `JUDGE_IMPL` fails at startup with a message saying it was replaced by `RERANKER`; covered by a config test.
   - A factory test shows that `jev`, `llm`, `bge` and `qwen3` each give their implementation, selected from the env object only.
   - `RERANKER=bge` or `qwen3` passes startup, and calling `rerank` throws an error saying the implementation is not yet implemented.
2. **`RERANKER=jev` without `JEV_API_KEY` fails with a clear error naming the missing key.**
   - Covered by a config test; the message names `JEV_API_KEY` and `RERANKER`.
3. **With `RERANKER=llm`, the query flow gives the same results as before this issue (existing tests stay green).**
   - The existing query-flow, generation and eval tests pass without weakening their assertions; where a test needs more than 8 approved chunks, it sets the top-K explicitly.
   - With `llm`, the chunks, scores, threshold rule, cache hits, call counts, unknown counts and token usage reported by the query flow equal what `judgeAll` produced before, up to the top-K cut.
   - `npm run query` with fake LLM roles runs end to end with `RERANKER=llm`.
4. **A test with a fake reranker shows that adding an implementation only takes a new file plus a factory entry.**
   - A test registers a fake reranker through the same registry the factory uses and gets it back for its `RERANKER` value, with no change to the query flow or `eval:run`.
5. **Every implementation returns `ScoredChunk` with scores in [0, 1], sorted best first, at most `topK`.**
   - A shared contract test runs against `jev` (fake JEV fetch), `llm` (fake LLM), and the fake reranker: scores in [0, 1], non-increasing, length ≤ `topK`, each `ScoredChunk` naming its reranker and model.
6. **Every new key is documented in `.env.example`.**
   - `RERANKER`, `RERANK_TOP_K` and `EMBEDDER` are documented; `JUDGE_IMPL` is removed.
7. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [x] `Reranker`, `RerankResult`, `ScoredChunk`, `Embedder` and `Embedding` types.
- [x] Reranker config: `RERANKER` (default `llm`), `RERANK_TOP_K` (default 8), the `JUDGE_IMPL` error, the JEV settings for `jev`. (**superseded by E8-3**: the default is `bge`)
- [x] Embedder config: `EMBEDDER` (`bge`, the only value).
- [x] Registry and factory for rerankers and embedders.
- [x] `JevReranker` (JEV judge with LLM fallback per call, through `judgeAll`) and `LlmReranker` (LLM judge, through `judgeAll`).
- [x] Placeholders: `BgeReranker`, `Qwen3Reranker`, `BgeEmbedder`. (**superseded by E8-2/E8-3**: only `qwen3` remains a placeholder)
- [x] Query flow, its setup and `npm run query` call the reranker; server startup validates the reranker config.
- [x] `eval:run` calls the reranker for its judge modes.
- [x] `.env.example` and README updated.
- [x] Tests: config, factory and registry, contract test, query flow and eval unchanged.

## Decisions

- **`RERANKER` replaces `JUDGE_IMPL`** (owner): one setting. A leftover `JUDGE_IMPL` fails at startup with a message pointing to `RERANKER`, so an old `.env` is not silently ignored. `RERANKER=jev` keeps today's `jev-with-fallback` behaviour per call (JEV first, the judge's LLM when a JEV call fails), but a missing `JEV_API_KEY` is now an error instead of a silent switch to the LLM, as the issue asks. Departs from the issue's open question by dropping the alias.
- **Default `RERANKER=llm` until E8-3** (owner): `BgeReranker` is a placeholder here, so `bge` as default would break the query flow until E8-3 is merged. E8-3 makes `bge` the default. Departs from the issue's "`bge` default".
- **`RERANK_TOP_K`, default 8** (owner): a new setting, matching "keep the best 5–8" in E8-3/E8-4. The generator's limits still apply afterwards. Consequence: the draft gets at most 8 chunks instead of up to 20.
- **The judge cache applies to `jev` and `llm` only** (owner): they are paid and slow, and the cache is already keyed by implementation and model. `bge` is local and its uncached time is what should be measured.
- **`rerank` returns a `RerankResult`, not a bare `ScoredChunk[]`** (default): `{ ranked: ScoredChunk[]; stats }`, where the stats are the calls, cache hits, unknown chunks, token usage and elapsed time the query flow and `eval:run` already report (and E7-3 will show). `ranked` is the issue's `ScoredChunk[]`. Departs from the issue's exact signature.
- **Threshold, then top-K** (from the issue): the reranker scores every chunk; chunks below `JUDGE_THRESHOLD` and unknown chunks are dropped, and the best `topK` of the rest are returned. Ties keep the candidate order, as `rankByScore` does today.
- **`eval:run` reranks with `topK` = the candidate count** (default): E5-3's precision and recall for the judge modes stay comparable to the first report. E8-5 adds measurements at other K.
- **`ScoredChunk`** (default): the `Chunk`, the normalised `score`, `reranker` (the implementation name) and `model`; for `jev`, also whether JEV or the LLM fallback answered (today's `judgedBy`).
- **`Embedding` shape** (default, settled with E8-2): `{ dense: Float32Array; sparse?: Map<string, number> }`, dense vectors normalised; `kind: 'query' | 'passage'` as in the issue. `EMBEDDER` has one value, `bge`, so it is read and validated but only the placeholder exists.
- **Registry** (default): a map from name to a constructor taking the config and shared dependencies. Adding an implementation is a new file and one map entry.

- **Registry entries validate and create** (settled while implementing): a `RerankerEntry` is `{ validate(env), create(env, deps) }`; `loadRerankerConfig(env, registry)` checks `RERANKER` against the registry's keys and runs the chosen entry's `validate`, so a missing `JEV_API_KEY` or a bad `JUDGE_*` setting fails at startup. Tests pass an extended registry for criterion 4. The embedder has the same shape (`EmbedderEntry`, `EMBEDDERS`).
- **`RerankResult` also carries `scored`** (settled while implementing): every chunk that got a score, best first, before the threshold and top-K. `eval:run`'s threshold sweep needs the scores below the threshold, which `ranked` drops.
- **`loadJudgeConfig(env, impl)`** (settled while implementing): the judge config no longer reads an implementation setting; the `jev` or `llm` reranker passes it. `JudgeConfig.impl` is `jev` (JEV with the LLM fallback) or `llm`. The JEV-only judge without fallback is no longer reachable from `.env`, so its factory test ("throws the JEV error for jev") was removed with the mode; the fallback judge's own tests are unchanged.
- **`eval:run` without a JEV key** (settled while implementing): `tags+jev` uses the `llm` reranker, as `jev-with-fallback` did without a key, so `eval:run` keeps working and the report says the LLM answered. With a key it uses `jev`.
- **The query output keeps its field names** (settled while implementing): `judging.{approved, cacheHits, judgeCalls, unknown}`, `timings.judgingMs` and `usage.judging` are filled from the reranker's stats, so the CLI output and E6's tests stay the same. `rankByScore` moved into the reranker as `bestFirst` (`rerank/rank.ts`); its tie-order test moved with it.
- **The server's startup warning for a missing JEV key is gone** (consequence of the owner's decision): `RERANKER=jev` without a key is now a startup error, and `llm` needs no warning.
- **Clean code**:
  - **No per-call cache option on `Reranker`**: the cache is a judge setting, so `eval:run` builds its rerankers with `JUDGE_CACHE=on` instead of passing a flag every reranker would have to accept.
  - **One sort per rerank, and relevance from `judgeAll`**: the judge-based reranker sorts once and keeps the chunks `judgeAll` found relevant, so the threshold rule lives in one place.
  - **`eval:run` reports each mode's reranker `name` and `model`** (`JudgeIdentity`) instead of rebuilding the judge module's `PrimaryJudge`.
  - **`Env` is exported from `env.ts`**; a shared `fakeRerankResult` test helper replaces four hand-built fakes.
- **Skipped clean-code suggestions**:
  - **Dropping `reranker`/`model` from `ScoredChunk`**: criterion 5 and the issue ask each `ScoredChunk` to name them.
  - **Judge-only fields (`db`, `llmConfig`, `answeredBy`) on the generic types**: they cost nothing for other rerankers now; revisit if E8-3 needs different dependencies.
  - **One generic registry helper for rerankers and embedders, and a table of renamed settings**: two small factories and one renamed key do not justify the abstraction yet.
- **Code review fixes**:
  - **The query output says when `RERANK_TOP_K` left relevant chunks out**: `RerankStats.relevant` counts the chunks that reached the threshold, and `npm run query` prints e.g. "approved: 8 (the best of 15 relevant; raise RERANK_TOP_K to keep more)".
  - **A chunk the LLM scored for a failed JEV call names the LLM's model**, not JEV's.
  - **`eval:run` does not read `RERANK_TOP_K`** (it keeps every relevant chunk) and builds one reranker per distinct name, so without a JEV key both judge modes share one.
  - **`createReranker` reads the reranker's settings once**: only `loadRerankerConfig` (startup) runs `validate`.
  - **The example drafts' settings note that `JUDGE_IMPL=llm` is now `RERANKER=llm`.**
- **PR review fixes**:
  - **`eval:run` builds the `llm` reranker once** and reuses it for `tags+jev` without a JEV key, instead of a memoising map.
  - **The eval setup test asserts that all three chunks are kept** (threshold 0), so it fails if eval ever cuts at a top-K.
- **Not changed (code review)**:
  - **`returned` for the judge modes is best first instead of candidate order**: only its length and set-based precision/recall are used, so the report is unchanged.
  - **`answeredBy` counts are judge-only**: a reranker without `answeredBy` (bge) would count as answered by neither; `eval:run`'s judge modes only use `jev` and `llm` until E8-5 reworks the report per reranker.

## Open Questions

- None.
