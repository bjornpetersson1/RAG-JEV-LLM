# E8-3 · BGE reranker

- **Issue:** [#67](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/67)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-1 (#65), E8-2 (#66)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 689 tests (685 backend, 4 frontend) and build exit 0; `npm run query` with the default `RERANKER=bge` and the real model; `npm run bench:rerank` measured on the demo machine)

## Summary

`BgeReranker` replaces E8-1's placeholder with `BAAI/bge-reranker-v2-m3`, a cross-encoder run on the runtime E8-2 chose. It scores every (query, chunk) pair, normalises the logit to 0–1 with a sigmoid, and becomes the default `RERANKER`, so the demo needs no paid judge.

## Goals

- `BgeReranker` implementing E8-1's `Reranker`, with batching and any concurrency limit inside it.
- The scored text is E8-2's `passageText`: the chunk's heading path (`context`) and text; truncation at 1,024 tokens, logged when it happens.
- Its own threshold setting, so the BGE score scale does not inherit `JUDGE_THRESHOLD`.
- Latency on the demo machine for 30 and 50 real chunks in fp32 and int8, in the README.
- `RERANKER=bge` as the default.

## Non-goals

- `npm run retrieve` and the bge candidate source (E8-4); this issue's criterion on `retrieve` is checked there.
- Comparing rerankers on recall, and choosing fp32 versus int8 on that basis (E8-5).
- Splitting long chunks and scoring their best part.
- Caching BGE scores (E8-1: cache for `jev` and `llm` only).
- Calibrating the BGE threshold on the evaluation set (E8-5 / #58).

## Acceptance Criteria

1. **`RERANKER=bge` gives a ranked list with scores in [0, 1] through the query flow.**
   - With `RERANKER=bge` and the real model, `npm run query` (fake generator allowed) reranks the candidates and reports the approved chunks with BGE scores in [0, 1], best first, at most `RERANK_TOP_K`.
   - E8-1's contract test also runs against `BgeReranker` with a fake model: scores in [0, 1], non-increasing, at most `topK`, `reranker` = `bge` and the model name set.
   - The same through `npm run retrieve` is verified in E8-4, which adds that command.
2. **Rerank latency for 30 and 50 chunks on the demo machine is reported in the README (median of 5 runs, load time separately).**
   - A committed script (e.g. `npm run bench:rerank`) reranks 30 and 50 real chunks from the database (average about 1,000 characters) against a Swedish instruction, in fp32 and int8, 5 runs each, and prints the median and the model load time.
   - The README table has those four medians and the two load times, with the machine named.
3. **Batching is internal: the calling code is the same for `bge`, `jev` and `llm`.**
   - The query flow and `eval:run` contain no reference to BGE, batching or the model; only the factory entry names `BgeReranker` (checked by review and by a grep in the verification).
4. **`npm test` runs without network access or downloaded models.**
   - Tests use a fake model; no test reads the model cache.
5. **`RERANKER=bge` is the default.**
   - The config default and `.env.example` both say `bge`; a config test covers the default.
6. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0.

## Tasks

- [x] `BgeReranker`: pairs of (instruction, context + text), batched, sigmoid on the logit, threshold then top-K as in E8-1, truncation at 1,024 tokens with a log line.
- [x] Settings: `RERANKER_DTYPE` (`int8` default, `fp32`), `RERANK_THRESHOLD_BGE` (default 0), and a batch size if the runtime needs one; documented in `.env.example`.
- [x] Register it in E8-1's factory; change the `RERANKER` default to `bge`.
- [x] `bench:rerank` script and README latency table.
- [x] Tests with a fake model; contract test.

## Decisions

- **`int8` by default** (owner): faster and half the memory on an 8 GB machine. E8-5 switches the default to fp32 if int8's recall@8 is more than 0.03 below fp32's.
- **Truncate at 1,024 tokens** (owner): chunks are at most 2,000 characters (about 500–700 tokens), so truncation should almost never happen; when it does, one log line names the chunk.
- **Its own threshold, `RERANK_THRESHOLD_BGE`, default 0** (owner): BGE's sigmoid scores are not calibrated like JEV's or the LLM's, so `JUDGE_THRESHOLD` keeps applying to `jev` and `llm` only. With 0, only `RERANK_TOP_K` cuts; E8-5 / #58 can set a measured value. Departs from E8-1's "threshold, then top-K" only in which threshold applies.
- **Same runtime as E8-2** (from E8-2): the model loads through E8-2's runtime and cache; E8-2's spike already showed it runs.
- **Model loaded once, lazily** (default): on the first `rerank` call, so a server with `RERANKER=llm` never loads it; the load time is logged and reported separately in the benchmark.
- **Builds on E8-1 and E8-2 as merged** (spec update before implementing):
  - The model loads through E8-2's `loadCrossEncoder` (`models/runtime.ts`) from `BGE_RERANKER_MODEL` (`onnx-community/bge-reranker-v2-m3-ONNX`, `models/catalog.ts`), with `loadLocalModelConfig(env, 'RERANKER')` for `RERANKER_DTYPE`, `RERANKER_BATCH_SIZE` and `MODEL_CACHE_DIR`.
  - The scored text is E8-2's `passageText` (heading path and text), not the judge's `judgedText` (source reference and text); the issue's "context + text" is this. The "as the judge reads it" in the Goals was wrong and is corrected. `Chunk` gets an optional `context`, which `loadChunks` now fills; a chunk without it is scored on its source reference and text.
  - E8-2's measurements: scoring takes 0.7–1.2 s per pair on the demo machine, so reranking 30 candidates takes roughly 20–40 s. `bench:rerank` measures it properly.
  - E8-2's code review: transformers.js 3.8 truncates a pair at `max_length` without a pair-aware strategy. `BgeReranker` therefore truncates the passage itself so the pair fits 1,024 tokens, and logs it.
  - E8-1's `RerankResult` (`ranked`, `scored`, `stats` with `relevant`) and `bestFirst` are used as they are; BGE needs no cache, so `calls` is the number of chunks scored and `cacheHits` 0.
- **Model cache moved to `data/models.nosync`** (owner, settled while implementing): the repo is in `~/Documents`, which iCloud Drive syncs, and uploading the 5.9 GB model cache loaded the CPU enough to distort the measurements. iCloud does not sync a folder ending in `.nosync`, so the default `MODEL_CACHE_DIR` changes (E8-2's code, `.env.example` and README) and the existing cache was renamed. `node_modules` is still synced.
- **Benchmark sample** (settled while implementing): 50 chunks spread evenly over the corpus by id (1,020 characters on average, as the spec assumes), not the first 50 (654 characters, mostly short law sections).
- **Measured latency** (criterion 2): int8 29.2 s for 30 chunks and 54.6 s for 50, fp32 41.7 s and 79.2 s (medians of 5, pairs batched by length), load 4.2 s / 9.7 s. Before length batching: int8 35.9 s and 64.6 s. Reranking is the slowest step of the query flow on the demo machine; E8-5 weighs it against recall.
- **Pair fitting lives in the runtime** (settled while implementing): `loadCrossEncoder` cuts the passage itself so the pair fits, and reports per pair whether it did; `BgeReranker` logs each cut chunk.
- **Clean code**:
  - **Pairs of similar length share a batch**: a batch is padded to its longest pair, so `BgeReranker` sorts the pairs by length before batching and puts the scores back in input order.
  - **One rerank at a time** (`oneAtATime`): each rerank uses every core, so two at once would only slow both down. This is the concurrency limit the spec places inside the implementation.
  - **Shared helpers in `models/runtime.ts`**: `lazyRetry` (load once, retry after a failed load) for the embedder and the reranker; the pair separators are read from the tokenizer instead of assumed, and each query is counted once per call.
  - **`BGE_RERANKER_MAX_TOKENS` lives in `models/catalog.ts`** next to the model, so `models:bench` does not import the reranker.
- **Skipped clean-code suggestions**:
  - **Always `passageText`, dropping the `judgedText` fallback**: a chunk built without a heading path (tests, or an empty `context`) would get a leading newline; the fallback keeps such a chunk readable.
  - **One corpus sampler for both benches**: E8-2's README table was measured on the first 100 chunks by id; changing `models:bench`'s sample would make that table stale.
  - **Keeping the cache default at `data/models`**: the owner chose `data/models.nosync` as the default.
  - **A shared bench argument parser, a shared silent logger, a shared ranking helper with the test fake**: small enough to leave.
  - **Not making `bge` the default until E8-5 has measured it**: the spec requires the default; E8-5 weighs the 35–50 s rerank time against recall.
- **Code review fixes**:
  - **The instruction gets its law abbreviations spelled out**, as for the embedder, since the heading paths name the laws in words.
  - **A failed batch leaves its chunks unknown** (logged), and the rest of the rerank stands; `stats.unknown` counts them. A failed model load still fails the rerank with its error, since nothing could be scored.
  - **A very long instruction is cut to half the pair** (512 tokens), so the passage keeps room; the cut is logged as "Pair cut to fit the reranker".
  - **The bench sample is spread exactly** (every n-th chunk by position, computed in TypeScript), and the bench fails when the database has fewer chunks than it needs.
  - **The contract test compares exactly** for `jev`, `llm` and the fake; only `bge`, whose scores pass through a sigmoid of the fake logit, uses `closeTo`.
  - **One silent logger** (`SILENT_LOGGER`, `llm/client.ts`) and **one bench instruction** (`BENCH_INSTRUCTION`) shared by `jev:probe`, `models:bench` and `bench:rerank`.
- **Not changed (code review)**:
  - **No timeout on the rerank queue**: an ONNX call cannot be cancelled, so a timeout could only stop waiting, not free the CPU; the demo has one user.
  - **No fallback for an old `data/models` cache**: the owner chose the new default, and the only existing cache was renamed.
  - **Each passage is tokenized twice** (once to fit, once in the batch): milliseconds against about a second of inference per pair.

## Open Questions

- None.
