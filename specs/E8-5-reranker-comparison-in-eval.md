# E8-5 · Reranker comparison in eval

- **Issue:** [#69](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/69)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-3 (#67), E8-4 (#68), E5-3 (#17)
- **Status:** Approved

## Summary

`eval:run` gets `--reranker` and `--retriever`, so recall@K before and after rerank, precision@5/@10 and latency are compared per retriever and reranker in one table that grows across runs in `eval/report-<date>.md`. A first run with BGE (fp32 and int8) and the LLM on the demo machine goes into the report, and the README explains how to switch reranker in three steps.

## Goals

- `npm run eval:run -- --reranker bge|jev|llm|qwen3[,…] [--retriever tags|bge|both[,…]]`.
- Per query and as a macro average: recall@K before and after rerank for K = 5, 8, 10 and the candidate count; precision@5 and @10.
- Latency per reranker and per retriever: median and p90 per query.
- One comparable table with a row per (retriever, reranker, model, dtype), appended across runs; E5-3's modes included as rows.
- A reranker that cannot run is reported as skipped with its reason; the others still run.
- A first run on the demo machine in the report; the fp32/int8 default decided from it (E8-3).
- README: "Switch reranker in three steps".

## Non-goals

- New evaluation queries: E5-3's 20 queries in `eval/queries.yaml` are reused.
- Graded relevance, the owner's label review, the candidate-count sweep and the JEV run (#58).
- Implementing `qwen3`.
- Running JEV live (no key; it is reported as skipped).
- Tuning `RERANK_THRESHOLD_BGE` or `JUDGE_THRESHOLD`.
- Changing the default `RETRIEVER` (E8-4: the owner switches after reading the report).

## Acceptance Criteria

1. **`eval:run -- --reranker bge,llm` prints and writes recall@K before and after rerank, and latency, per reranker in one table.**
   - The printed and written table has columns: date, retriever, reranker, model, dtype, recall@5/@8/@10/@candidates before and after rerank, precision@5/@10 after rerank, rerank latency median/p90, retrieval latency median/p90, queries evaluated.
   - "Before rerank" is the retriever's own order; for `tags` with no reranker this is E5-3's `tags` mode, and `fts` appears as a baseline row.
   - `--retriever tags,bge,both` gives one row per retriever and reranker; without `--retriever`, the configured `RETRIEVER` is used.
   - A test with fake retrievers and rerankers checks the metrics and the table on a small fixed case (known recall@K and precision@K).
   - Rerank latency is measured with the judge cache off for `jev` and `llm` rows that report latency, or the row says the latency includes cache hits (see Decisions).
2. **`--reranker jev` without `JEV_API_KEY` is reported as skipped with a clear reason, without crashing the run.**
   - Covered by a test, and the same for `qwen3` ("not implemented"); the other rerankers' rows are still written, and the skipped row names the reason.
3. **The report includes a first BGE run (fp32 and int8) on the demo machine.**
   - `eval/report-<date>.md` has rows for `bge` in fp32 and int8 and for `llm` (via the `claude-code` provider), over the 20 queries, on today's labels, with a note that the labels are not yet reviewed by the owner (#58).
   - The report states the fp32/int8 decision: the default `RERANKER_DTYPE` becomes `fp32` if int8's recall@8 after rerank is more than 0.03 below fp32's, else stays `int8`; `.env.example` and the config default follow.
   - No ANTHROPIC API key reaches the `claude` process during the run (checked before the run as in E5-3).
4. **The README describes switching reranker in three steps.**
   - 1. set `RERANKER=` in `.env`; 2. fill in its keys or download its model; 3. verify with `npm run retrieve` / `npm run eval:run -- --reranker <name>`.
5. **Switching from BGE to JEV takes only `RERANKER=jev` and `JEV_API_KEY` in `.env`; no other code changes.**
   - A factory test builds the reranker from `{ RERANKER: 'jev', JEV_API_KEY: '…' }` and gets the JEV reranker, and the query flow runs with it against a fake JEV fetch.
6. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [ ] CLI options `--reranker` and `--retriever` (comma-separated, validated).
- [ ] Metrics: recall@K and precision@K before/after rerank, latency median/p90.
- [ ] Run loop: per query, retrieve once per retriever, rerank once per reranker; skipped rerankers with a reason.
- [ ] Report: append rows to the comparison table in `eval/report-<date>.md` (creating the table if absent), and print it.
- [ ] First real run (bge fp32, bge int8, llm; retrievers tags, bge, both) and the dtype decision.
- [ ] README "Switch reranker in three steps".
- [ ] Tests with fakes.

## Decisions

- **E5-3's modes are rows in the same table** (owner): `tags`, `bge`, `both` with reranker `none` give the before-rerank picture, `fts` is a baseline, and `tags` + `llm` is E5-3's `tags+llm`.
- **Measure on today's labels** (owner): the report says they are unreviewed; after #58 the run is repeated and new rows are appended.
- **The first run includes `llm` via the Claude Code subscription** (owner): with the judge cache on, so E5-3's cached scores are reused where the candidates are the same. Latency for cached rows would be misleading, so `llm` latency is taken from a cache-off pass over a subset of queries (5) and the row says so; recall and precision use all 20.
- **K values** (from the issue): 5, 8 (`RERANK_TOP_K` default), 10 and the candidate count. For reranked rows, rerank uses `topK` = the candidate count so recall@K can be read at every K (E8-1's eval rule).
- **Recall before rerank with `both`** (from E8-4): the RRF order.
- **The fp32/int8 rule** (from E8-3): a difference of more than 0.03 in recall@8 after rerank switches the default to fp32.
- **Rows appended across runs** (from the issue): a run on another day, e.g. JEV once credits exist, appends to that day's report, and the table header is the same in every report, so rows can be compared side by side.

## Open Questions

- None.
