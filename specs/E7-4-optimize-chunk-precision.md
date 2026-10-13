# E7-4 · Optimize chunk precision

- **Issue:** [#58](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/58)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement (last issue of E7)
- **Depends on:** E5-3 (#17), E8-5 (#69), E7-5 (#78); after E7-3 (#24)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 915 tests (862 backend, 53 frontend) and build exit 0; `npm run eval:run -- --sweep` on the demo machine with minilm and the Claude Code subscription, table and choice in `eval/report-2026-10-13.md`)

## Summary

Measure and tune what reaches the generator: the evaluation set gets graded relevance (central / related), `eval:run` reports precision@5/@10 before and after rerank and against both grades, and a sweep over the candidate count and `RERANK_TOP_K` picks new defaults by F1 on central chunks with a recall floor. The JEV criterion and the owner's label review move to #79 (E7-6), so this issue can close while JEV credits cannot be bought.

## Goals

- Graded labels in `eval/queries.yaml`: every relevant chunk gets `grade: central` (the provision or reasoning the clause rests on) or `grade: related` (other parts of the same case or law), set by Claude with the reasoning in the file header.
- `eval:run` reports precision and recall against `central` and against `central + related`, and precision@5/@10 before rerank (the retriever's order) as well as after (the reranker's score order, as E8-5 does).
- `eval:run -- --sweep` over candidate counts 10/20/30/40/50 and `RERANK_TOP_K` 5/8/10/12, with the default reranker and retrievers `tags` and `both`, giving precision, recall and F1 on central chunks and the rerank time per setting.
- New defaults for `MAX_CANDIDATES`, `RETRIEVE_CANDIDATES` and `RERANK_TOP_K`, chosen by the rule below and justified in the report.

## Non-goals

- The JEV run, the JEV vs LLM comparison and setting `JUDGE_THRESHOLD`: moved to #79 (E7-6), blocked by JEV credits.
- The owner's review of `eval/queries.yaml`: moved to #79.
- A cut-off on the number of matching tags, or on a minimum judge score (owner: sweep the counts only).
- New queries, or a lawyer's review of a sample.
- Changing retrievers, rerankers or the generator.

## Acceptance Criteria

1. **`eval:run` reports precision@5 and precision@10 per mode in addition to precision and recall.**
   - E5-3's mode table and E8-5's comparison table both show P@5 and P@10; the comparison table also before rerank.
   - Precision@k before rerank uses the retriever's order; after rerank, the reranker's score order.
   - Metric unit tests cover precision@k with fewer than k chunks returned (counted as not relevant).
2. **The number of candidates passed to the judge is configurable and swept in `eval:run`, and the chosen default is justified by the report.**
   - `MAX_CANDIDATES` (tags) and `RETRIEVE_CANDIDATES` (bge, both) stay the settings; `--sweep` runs the grid above and appends a sweep table to `eval/report-<date>.md`.
   - The rule: among the settings whose recall on central chunks is at most 0.03 below today's defaults (candidates 30/40, top-k 8), the one with the highest F1 on central chunks wins; on a tie within 0.01, the fewer candidates (faster rerank). The report applies it and `.env.example`, the config defaults and the README follow.
   - Each count gets the list the retriever configured for it gives (`tags` with `MAX_CANDIDATES` = N; `both` with `RETRIEVE_CANDIDATES` = N over the configured tag search, whose `MAX_CANDIDATES` caps its tag ranking in the query flow too); each query's lists are reranked once together, and each list keeps its chunks in that score order; a test shows this gives the same result as reranking each list directly with a deterministic fake, also for a list that is not a prefix. (Changed while implementing: a fused `both` list of N is not the first N of a longer one, so "the first N" would measure lists no setting produces.)
3. **The evaluation set uses graded relevance, and precision is reported for both grades.** (The owner's review moves to #79.)
   - Every entry under `relevant` has `grade: central` or `grade: related`; the loader rejects a missing or unknown grade, with a test.
   - `eval:run` and the comparison report precision and recall for `central` and for `central + related`.
4. **The JEV criterion moves to #79.**
   - #58's description says the JEV run and the label review moved to #79; the README's evaluation section points there.
5. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.
   - The sweep is run on the demo machine and its table is in the report and quoted in the PR.

## Tasks

- [x] Grade the 266 labels in `eval/queries.yaml`; loader and types for `grade`.
- [x] Metrics: precision@k before rerank; precision/recall per grade.
- [x] `--sweep` in `eval:run`: per-count lists, their union reranked once per query, the sweep table.
- [x] Run the sweep; apply the rule; update defaults, `.env.example` and README.
- [x] Update #58's description; README pointer to #79.
- [x] Tests.

## Decisions

- **Claude grades, the owner's review moves to #79** (owner): the review is a manual step that would stop the epic. #79 already holds the blocked JEV criterion.
- **No fixed precision target; best F1 on central chunks with a recall floor of 0.03** (owner): with 20 queries and one labeller, a hard target would be arbitrary.
- **Sweep candidate count and `RERANK_TOP_K`, not a tag cut-off or score threshold** (owner): the counts are what drive both precision and rerank time; the judge threshold belongs to JEV (#79).
- **The default reranker is the one E7-5 leaves as default** (default): the sweep tunes the configuration the demo runs.
- **Rerank once at the largest count** (default): a cross-encoder scores each pair independently, so smaller counts reuse the scores, cutting the sweep's time about fivefold. An LLM or JEV reranker would also score independently.
- **Precision@k from both orders** (from the issue's open question): before rerank shows the retriever, after rerank the reranker.
- **`fts` stays a baseline only** (default), not swept.

- **Settled while implementing**:
  - **Grades in the YAML** (`grade: central | related` on every relevant entry; the loader rejects a missing or unknown one). `ResolvedQuery` has `relevantIds` (all graded) and `centralIds`; `relevantFor(query, scope)` picks one. 131 of the 266 labels are central.
  - **The comparison table has a row per grade** and P@5/P@10 before rerank. Its columns changed, so it has a new heading (`## Retriever and reranker comparison, graded`); a report's earlier table keeps its own.
  - **E5-3's mode table** gains a row per grade with P@5/P@10; its per-query table and the judge threshold sweep stay on every graded chunk (the threshold is #79's).
  - **The sweep uses the query flow's retrievers**: `tags` with its full-text fallback (as `RETRIEVER=tags` runs), not E5-3's tags-only mode, and `both`. Each count gets the list the retriever configured for it gives; the union of a query's lists (all counts, both retrievers) is reranked once, and each list keeps its chunks in that score order (clean code: a fused list of 10 is not the first 10 of one of 50, so the spec's "first N of the largest" would have measured lists no setting produces; a test covers lists that are not prefixes). The rerank time per setting is an estimate, each query's time per candidate times N.
  - **`RERANK_TOP_K` is shared by the retrievers**, so it follows the default retriever `tags`, for which the rule chose 8; the rule chose 12 for `both`, which the README and `.env.example` recommend with `RETRIEVER=both`.
  - **The rule's tie-break** is the spec's: within 0.01 of the best central F1, the fewest candidates, and of those the highest central F1 (code review: an extra "fewest kept" tie-break was removed). A retriever with no measured query gets no choice.
  - **The sweep reranks without the cache**, so the rerank time estimates are real for a cached reranker too; `both` embeds each query once, not once per count.
  - **Every query needs a `central` chunk**: the loader rejects a query graded only `related`, whose central recall would always be 0.
  - **The sweep set the defaults** (`eval/report-2026-10-13.md`): `MAX_CANDIDATES` stays 30 (best central F1 with `tags`, 0.221), `RETRIEVE_CANDIDATES` 40 → 20 (central F1 0.194 at top 12 against 0.123 with `both`), `RERANK_TOP_K` stays 8. `RETRIEVE_CANDIDATES` also applies to `RETRIEVER=bge`, which the sweep did not cover. Two earlier runs measured `both` wrongly (prefixes of the 50-list, then a tag ranking capped at N instead of `MAX_CANDIDATES`, caught by code review); their rows were removed.
  - **#58's description** says the JEV criterion and the label review moved to #79.

## Open Questions

- None.
