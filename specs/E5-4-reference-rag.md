# E5-4 · Reference RAG

- **Issue:** [#18](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/18)
- **Labels:** `E5 JEV`
- **Phase:** 5. UI and measurement (shipped in the E7 epic, before E7-1)
- **Depends on:** E2-4 (#7), E6-2 (#20), E6-3 (#21), E5-3 (#17), E8-4 (#68)
- **Status:** Approved

## Summary

A plain reference RAG (embed the instruction, take the dense top k from E8-4's vector index, the same generator and post-check) runs the same 20 evaluation queries as the main flow. `npm run bench:compare` runs both flows five times per query and prints one comparison table of medians for total, search and LLM time, plus precision, recall and source accuracy, so "faster than a regular RAG" is measured, not claimed.

## Goals

- A reference flow: embed the instruction with the configured `EMBEDDER` (`kind: 'query'`) → cosine top `REFERENCE_TOP_K` over E8-4's vector index → the same `generateDraft` (E6-2) with the same template and context limits → the same post-check (E6-3).
- The same timing breakdown as the main flow: embedding, search, generation, total.
- `npm run query -- "<instruction>" --template <id> --reference` runs the reference flow in the terminal, with the same output format as the main flow.
- `npm run bench:compare`: both flows over the evaluation queries, five runs each, medians in one table.
- Tests with a fake embedder and fake LLM roles, no network access.

## Non-goals

- An HTTP endpoint for the reference flow: E7-1 builds the API layer, and `POST /api/query` gets the reference flow as an option there (owner).
- New embedding or vector-search code: the embedder, `chunk_embeddings` and `denseRanking` from E8-2/E8-4 are reused unchanged.
- BM25, RRF, named-provision pinning or reranking in the reference flow: it is deliberately a plain RAG.
- Changing the main flow's defaults (`RETRIEVER`, `RERANKER`, `RERANK_TOP_K`).
- The timing panel and the run log (`logs/runs.jsonl`): E7-3.
- Precision work and candidate counts: E7-4 (#58).

## Acceptance Criteria

1. **It can be run on the evaluation queries.**
   - `npm run bench:compare` runs every query in `eval/queries.yaml` through the main flow and the reference flow.
   - `npm run query -- "<instruction>" --template employment --reference` prints a draft, the sources sent and cited, the post-check and the time per step, without query translation or reranking.
   - Without vectors (`npm run index:embed` not run), both fail with a message naming `npm run index:embed`.
2. **It gives the same measures as the main flow: total time, search time, LLM time, precision, recall and source accuracy.**
   - Search time: main flow = retrieval and loading the candidates (as `StepTimings.searchMs`); reference = embedding the instruction plus the vector search and loading the chunks. Embedding is also shown on its own.
   - LLM time: query translation + generation, plus reranking when `RERANKER` is `llm` or `jev`. A local reranker (`bge`) is shown as its own column and is not LLM time.
   - Precision and recall: of the chunks sent to the generator (main: the reranker's approved chunks; reference: the top k), against the labels in `eval/queries.yaml`, macro-averaged over the queries and averaged over the runs.
   - Source accuracy: valid references / all references over every draft of the flow, from E6-3's post-check.
   - A unit test with fakes checks every measure for both flows on a small query set.
3. **`bench:compare` prints a comparison table using medians of 5 runs.**
   - One row per flow; median and p90 for total, search, rerank, generation and LLM time; precision, recall, source accuracy; the number of queries and drafts; the configuration (retriever, reranker, embedder, k, generator model).
   - `--runs <n>` (default 5), `--limit <n>` (first n queries) and `--no-draft` (no generation; generation and source accuracy columns show `–`).
   - The table is printed and appended to that day's `eval/report-<date>.md` under "Main flow vs reference RAG".
   - The full default run (20 queries × 5 runs, generation on, the Claude Code provider) is made once on the demo machine and its table is in the report and quoted in the PR.
   - A query that fails in a run is listed and left out of that run; the command then exits non-zero.
4. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [ ] `REFERENCE_TOP_K` (default 8) in config and `.env.example`.
- [ ] Reference flow: embed → `denseRanking` → load chunks → `generateDraft`, with timings, returning the same result shape as `runQuery` (no tags, rerank fields empty).
- [ ] `--reference` in `npm run query`.
- [ ] `bench:compare` command and its argument parsing.
- [ ] Benchmark runner: warm-up (load the embedder and the reranker before timing), alternate the flows within each run, judge cache off.
- [ ] Measures and the table (reuse `eval` metrics, `stats` medians and the report writer).
- [ ] README: reference RAG, `bench:compare`, how to run it on the subscription, and the first result.
- [ ] Tests with fakes.

## Decisions

- **Plain dense top-k** (owner): the reference is "a regular RAG": cosine over bge-m3 vectors, no lexical half or rerank. E8-4's hybrid stays a main-flow retriever (`RETRIEVER=bge`).
- **`REFERENCE_TOP_K`, default 8** (owner): the same as `RERANK_TOP_K`'s default, so both flows give the generator about as many chunks and the generation times compare.
- **Full run by default, with flags to cut it down** (owner): the issue's 5 runs with generation. About 200 generator calls take hours on the subscription; the full run is made once and reported. E8-5 measured retrieval and rerank only, without generation or the reference flow.
- **No HTTP endpoint here** (owner): E7-1 builds `POST /api/query` with a reference option.
- **The main flow runs as `.env` configures it** (default): `RETRIEVER`, `RERANKER` and `RERANK_TOP_K` as set, so the benchmark measures what the demo runs. The table states the configuration.
- **Judge cache off during the benchmark** (default): otherwise runs 2–5 of an `llm` or `jev` reranker are cache hits and the medians measure the cache. `bge` has no cache.
- **Models are loaded before timing and the flows alternate within a run** (default): neither flow pays the model load, and drift on the machine hits both.
- **LLM roles via the Claude Code provider for the real run** (owner's billing rule): the README command sets `LLM_PROVIDER=claude-code`, which starts `claude` without `ANTHROPIC_API_KEY`.
- **Precision and recall over the chunks sent to the generator** (default): that is what each flow hands on; E7-4 adds precision@k.
- **Results appended to `eval/report-<date>.md`** (default): like E8-5, so the comparison sits next to the retriever and reranker table.

## Open Questions

- None.
