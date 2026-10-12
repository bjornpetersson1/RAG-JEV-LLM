# E8-3 · BGE reranker

- **Issue:** [#67](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/67)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-1 (#65), E8-2 (#66)
- **Status:** Approved

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

- [ ] `BgeReranker`: pairs of (instruction, context + text), batched, sigmoid on the logit, threshold then top-K as in E8-1, truncation at 1,024 tokens with a log line.
- [ ] Settings: `RERANKER_DTYPE` (`int8` default, `fp32`), `RERANK_THRESHOLD_BGE` (default 0), and a batch size if the runtime needs one; documented in `.env.example`.
- [ ] Register it in E8-1's factory; change the `RERANKER` default to `bge`.
- [ ] `bench:rerank` script and README latency table.
- [ ] Tests with a fake model; contract test.

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

## Open Questions

- None.
