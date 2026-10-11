# E8-1 · Reranker and Embedder interfaces

- **Issue:** [#65](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/65)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E5-1 (#15), E5-2 (#16)
- **Status:** Approved

## Summary

The relevance step moves behind one `Reranker` interface, chosen in `.env` with `RERANKER=bge|jev|llm|qwen3`, and an `Embedder` interface is added for E8-2 and E8-4. JEV and today's LLM judge become rerankers with unchanged behaviour, so the local BGE models from E8-2/E8-3 can be demoed now and JEV switched in once credits can be bought.

## Goals

- A `Reranker` interface with a `ScoredChunk` result that is the same for every implementation.
- An `Embedder` interface for queries and passages, with a dense vector and an optional sparse part.
- One factory reading `RERANKER` and `EMBEDDER`; no other code branches on the implementation.
- `JevReranker` and `LlmReranker` on top of the existing JEV client, JEV judge, fallback judge, LLM judge and `judgeAll` (concurrency, timeouts, cache).
- Placeholders `BgeReranker`, `Qwen3Reranker` and `BgeEmbedder` that are registered and throw "not implemented".
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

- [ ] `Reranker`, `RerankResult`, `ScoredChunk`, `Embedder` and `Embedding` types.
- [ ] Reranker config: `RERANKER` (default `llm`), `RERANK_TOP_K` (default 8), the `JUDGE_IMPL` error, the JEV settings for `jev`.
- [ ] Embedder config: `EMBEDDER` (`bge`, the only value).
- [ ] Registry and factory for rerankers and embedders.
- [ ] `JevReranker` (JEV judge with LLM fallback per call, through `judgeAll`) and `LlmReranker` (LLM judge, through `judgeAll`).
- [ ] Placeholders: `BgeReranker`, `Qwen3Reranker`, `BgeEmbedder`.
- [ ] Query flow, its setup and `npm run query` call the reranker; server startup validates the reranker config.
- [ ] `eval:run` calls the reranker for its judge modes.
- [ ] `.env.example` and README updated.
- [ ] Tests: config, factory and registry, contract test, query flow and eval unchanged.

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

## Open Questions

- None.
