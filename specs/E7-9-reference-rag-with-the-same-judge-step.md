# E7-9 · Reference RAG with the same judge step

- **Issue:** [#94](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/94)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** none (related: E7-7 (#90), E7-8 (#91), E5-4 (#18), E7-6 (#79))
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 936 tests (877 backend, 59 frontend; `npm test` offline under sandbox-exec, loopback only) and build exit 0; `bench:compare -- --runs 1` with drafts and the shared Haiku judge, 20 queries, no failures, in `eval/report-2026-10-13.md`)

## Summary

The reference RAG gets the same steps as the main flow: vector search, then the same LLM judge (same threshold and top-k), then the same generator. The comparison then measures how the candidates are found (tags against vectors), not "a flow with a judge" against "a flow without one". The measurements are also made fairer where they still differ, and the report names every difference that remains.

## Goals

- **Reference flow:** embed the instruction → the `MAX_CANDIDATES` nearest chunks by cosine → the LLM judge (`JUDGE_THRESHOLD`, capped at `RERANK_TOP_K`) → the same generator and post-check. It has no translation step.
- **UI, run log and `bench:compare`:** show the reference's judge step, judge time and time to sources like the main flow's, and each flow's judge-cache hits.
- **Fairer `bench:compare`:**
  - generation, ms/token, output tokens and source accuracy are compared only over the query and run pairs where both flows wrote a draft;
  - the number of pairs each flow left without a draft (nothing approved) is shown;
  - the number of chunks the judge could not score (unknown) is shown per flow.
- **Re-run** `bench:compare -- --runs 1` with drafts and rewrite the report's analysis.
- **Documentation:** the README and the requirements text describe the reference RAG as the "100 % LLM" counterpart of the main flow.
- **A new issue** for labelling the chunks only vector search finds.

## Non-goals

- Re-labelling `eval/queries.yaml`. The labels were made from tag-search and full-text candidates (`eval:label`), so they favour the main flow. The report says so, and a new issue covers the fix.
- JEV as the main flow's judge (E7-6, #79). The reference keeps the LLM judge whatever `RERANKER` says.
- A rerank step other than the LLM judge in the reference (`bge`, `minilm`, `jev`).
- Turning the judge cache off in the UI. The panel shows each flow's cache hits instead.
- Changing the main flow, its defaults (`RETRIEVER`, `RERANKER`, `RERANK_TOP_K`, `MAX_CANDIDATES`), the judge's question or its timeouts.
- Five benchmark runs. One run with drafts, as in E7-8.

## Acceptance Criteria

1. **The reference RAG runs vector search, then the same judge (threshold, top-k), then the same generator; tests prove it judges and can return no draft.**
   - Its search returns the `MAX_CANDIDATES` chunks most similar to the instruction.
   - It judges them with the `llm` reranker at `JUDGE_THRESHOLD`, keeps at most `RERANK_TOP_K` relevant ones, and hands only those to the generator. This holds also when `RERANKER` is not `llm`.
   - When `RERANKER=llm`, both flows use one reranker instance.
   - When the judge approves nothing, no draft is written, and the result says so.
   - `REFERENCE_TOP_K` is gone from config, `.env.example` and the README. If it is still set in `.env`, startup fails with a message saying to remove it.
   - Unit tests with fakes and no network prove each point above through `runQuery` and `createReferenceFlow`.
2. **The timing panel and `bench:compare` show the reference's judge time and time to sources.**
   - The panel shows a judge row for the reference, with its time, time per judged candidate and cache hits.
   - The reference's time to sources is search plus judging.
   - The run log records the reference's `judgingMs`, `sourcesMs` and judging stats.
   - `bench:compare` shows the reference's rerank and time to sources (median, p90), and counts its judging as LLM time.
   - Frontend and backend tests cover these.
3. **`bench:compare` compares the flows on the same samples and shows what differs.**
   - Generation, ms/token, output tokens and source accuracy are computed per flow over the same pairs: those where both flows wrote a draft.
   - The table shows, per flow, the pairs without a draft and the median number of candidates judged.
   - The table shows, per flow, the total number of chunks the judge could not score.
   - A unit test with fakes covers a pair where only one flow writes a draft, and a pair with unknown chunks.
4. **The report compares the two flows with the same judge, with numbers, and says what the tag search wins or loses against vector search.**
   - A new `bench:compare -- --runs 1` with drafts (the Claude Code provider, judge cache off) has its table in that day's `eval/report-<date>.md`.
   - The analysis states, with numbers, time to sources, total time, precision, recall, source accuracy and pairs without a draft for both flows.
   - It names the differences that remain:
     - the labels come from tag and full-text candidates;
     - the translation step only the main flow has;
     - the number of candidates judged;
     - the embedding step only the reference has;
     - the search text (instruction plus tags and template presets, against the instruction alone);
     - unknown chunks and the judge's total timeout;
     - each flow's cache hits in the UI.
   - The new labelling issue is created and linked from the report.
5. **`npm test` runs without network access.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0, with `npm test` offline.

## Tasks

- [x] Reference search: dense top `MAX_CANDIDATES`.
- [x] Reference judge: the `llm` reranker with `RERANK_TOP_K`, shared with the main flow when `RERANKER=llm` (API server and `bench:compare`).
- [x] Remove `REFERENCE_TOP_K`, and reject it at startup with a message.
- [x] `bench:compare`: mark the reference's rerank as remote, compare drafts over shared pairs, count pairs without a draft, show candidates judged and unknown chunks.
- [x] Timing panel and flow progress: the reference's judge row and cache hits (check that the generic step code covers it; fix whatever does not).
- [x] Tests with fakes for every criterion.
- [x] README (reference RAG, `bench:compare` columns) and `Constitution/Requirements-and-goal.md` (E5-4's line).
- [x] Re-run `bench:compare -- --runs 1` with drafts, and rewrite the report's analysis.
- [x] Create the labelling issue for vector-only candidates.

## Decisions

- **The reference retrieves `MAX_CANDIDATES` (30) before judging** (owner). The judge gets as many candidates as the main flow's tag search at most. The tag search can return fewer (full-text search only fills up to `MIN_TAG_CANDIDATES`), so the report states the median judged per flow.
- **`REFERENCE_TOP_K` is removed** (owner). The judge cuts at `RERANK_TOP_K` as in the main flow, so the setting would be dead. Startup rejects it, as `JUDGE_IMPL` is rejected, so a stale `.env` is not silently ignored.
- **The reference always uses the LLM judge** (owner). The reference is the "100 % LLM" counterpart. Today `RERANKER=llm`, so both flows use the same judge, threshold and top-k. After E7-6, the main flow's JEV is compared against the LLM judge. This narrows the issue's "one reranker shared by both flows" to the case `RERANKER=llm`.
- **One run with drafts** (owner). The same scope as E7-8.
- **Drafts are compared over shared pairs** (owner, after reviewing what else differs). A judge can approve nothing, so the flows can write drafts for different queries. Generation and source accuracy would then compare different queries. Total time stays over all measured pairs, as before, and the count of pairs without a draft explains a gap.
- **Unknown chunks are counted per flow** (owner). The judge's 60 s total timeout at concurrency 8 may cut more often with 30 candidates, which shortens judge time and lowers recall.
- **The UI keeps the judge cache on and shows each flow's cache hits** (default). The reference runs after the main flow on the same instruction, so chunks both flows found are cache hits for the reference. Turning the cache off for one flow would make the UI unfair the other way. `bench:compare` already runs with the cache off.
- **Label bias goes into the report and a new issue** (owner). Re-labelling 20 queries is outside this issue.
- **The E7-8 decision "the reference RAG stays as the requirements define it" is reversed** (owner, issue #94).

- **Settled while implementing:**
  - **The reference's judge is built by `createReranker` with `RERANKER=llm`**, so it reads the same `JUDGE_*` settings and `RERANK_TOP_K` as the main flow's LLM judge. `createReferenceFlow` takes the main flow's reranker and uses it when its name is `llm`; the API server and `bench:compare` pass it.
  - **`createQueryFlows` returns `ConfiguredQueryFlows`**, whose flows carry their rerankers, so a test can see that both share one judge without a cast.
  - **The run log gets a `judging` field** (relevant, cache hits, judge calls, unknown) for every flow with a rerank step: the spec asks for the reference's judging stats there, and the log had none.
  - **The `bench:compare` table has a new heading, "Main flow vs reference RAG: the same judge"**, with the columns `judged`, `unknown` and `without draft`; as in E7-8, rows are never appended under an older table's header. `without draft` is `–` with `--no-draft`.
  - **`npm run query -- --reference` prints "the N chunks most similar to the instruction (no tags)"** followed by the judge's counts, like the main flow.
  - **The labelling issue is #95 (E7-10)**, on the board as Todo.
- **Clean code:**
  - **`ReferenceFlow` is `ConfiguredQueryFlow`**, and both flows label their reranker with one `rerankerLabel`.
  - **`loadReferenceConfig` validates the reference's LLM judge settings at startup** (`server.ts`), also when `RERANKER` is another reranker, and gives `MAX_CANDIDATES` and `RERANK_TOP_K` once.
  - **Not done: making `rerank` required in `QueryFlowDependencies`** and removing the "no rerank step" paths (`FlowProgress`, `format.ts`, optional `judging`). No production flow lacks a rerank step now, but the query-flow interface still describes one, and the change reaches far outside this spec. The same goes for sharing a judge per name inside the reranker factory.
- **Code review (high):**
  - **Fixed: a draft without text counts as no draft** in `bench:compare` (no approved chunk fitted the context limits), as before E7-9.
  - **Fixed: `judged` counts the candidates the rerank was given** (the loaded sources), not the search hits.
  - **Not changed: the UI keeps the judge cache on, so the reference can get cache hits from the main flow.** The spec's decision: the panel shows each flow's cache hits, and `bench:compare`, where the numbers are compared, runs with the cache off.
  - **Not changed: total and LLM time stay over every measured pair.** The spec's decision: the `without draft` column explains a gap there; only the draft measures are paired.
  - **Not changed: sharing the judge by comparing the main reranker's name with the reference's own `REFERENCE_RERANKER`.** This does not choose an implementation by `RERANKER` (the registry still does that); it asks whether the main flow already built the judge the reference needs.
  - **Not changed: `ConfiguredQueryFlows`.** It lets a test check that the API server's wiring shares the judge; a `createReferenceFlow` test alone cannot see that wiring.
  - **The benchmark run started before these two fixes.** The definitions only differ when a draft had no text or a candidate did not load.

## Open Questions

- None.
