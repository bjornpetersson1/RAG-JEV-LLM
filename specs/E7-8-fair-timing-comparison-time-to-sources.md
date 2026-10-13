# E7-8 · Fair timing comparison: time to sources

- **Issue:** [#91](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/91)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** none (related: E7-7 (#90), E7-3 (#24), E5-4 (#18))
- **Status:** Approved

## Summary

The comparison between the main flow and the reference RAG should measure what the thesis is about. The headline measure becomes **time to sources**: search plus rerank or judge, which is everything that finds the sources except the query translation. The translation is shown separately next to it. Generation is reported per output token, with the token counts, so that a longer draft no longer decides which flow is "faster". The timing panel, the run log and `bench:compare` all report it. A new `bench:compare` run with drafts states in the report, with numbers, where the main flow wins and where it loses.

## Goals

- A `sourcesMs` timing: `searchMs + judgingMs` (search alone for a flow without a rerank step). Each flow reports it as soon as its sources are known, and the run log carries it.
- **Timing panel:**
  - a "Tid till källor" row for both flows, and the difference between them, with the translation shown separately;
  - the generation row also shows the number of output tokens and the time per token.
- **`bench:compare`:** time to sources (median, p90) per flow, generation per output token (median ms/token), and the median output tokens.
- The report states, with numbers, whether the main flow returns sources faster than the reference RAG, and which steps make the difference.

## Non-goals

- **Changing the reference RAG.** The owner kept the requirements' definition: embeddings, top-k and the same generator (E5-4).
- **A length limit on the drafts.** The owner chose normalisation per token.
- **Removing total time.** It stays in the panel, the run log and the benchmark, next to the new measures.
- **Making any step faster.** JEV is #79; a pre-filter would be its own issue.
- **Five benchmark runs.** The owner chose one run with drafts; see Decisions.

## Acceptance Criteria

1. **The timing panel shows "tid till källor" for both flows and the difference between them.**
   - Each flow's `timings.sourcesMs` is `searchMs + judgingMs`, or `searchMs` without a rerank step. It is in the step event that completes the sources (`rerank`, or `search` without one), in the result, and in the run log line. Query-flow tests cover both kinds of flow.
   - The panel has a "Tid till källor" row. The comparison sentence states the difference in time to sources (for example "Huvudflödet hade sina källor X s senare än referens-RAG:en") and names the translation time separately when the flow translated. The total-time difference stays.
   - The generation row shows the time with the output tokens and the ms per token, for example "21,7 s (1 210 tokens, 18 ms/token)".
   - Frontend tests cover the row, the sentence and the generation detail.
2. **`bench:compare` reports time to sources (median, p90) per flow, and generation normalised per token.**
   - The table gets the columns "sources", "generation ms/token" and "output tokens" (medians, and p90 for sources). A test covers the summary with fake flows.
   - The README's benchmark section explains the measures.
3. **The report states, with numbers, whether the main flow returns sources faster than the reference RAG, and which steps make the difference.**
   - `npm run bench:compare -- --runs 1` (with drafts, default `RERANKER=llm`, judge cache off, the Claude Code subscription) is appended to `eval/report-<date>.md`, with a short analysis per step: translation, search, judge, generation per token, and total.
4. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [ ] `StepTimings.sourcesMs` in the query flow: in the step event, the result and the run log. Add tests.
- [ ] Frontend: the "Tid till källor" row, the comparison sentence with the translation shown separately, and the generation tokens and ms/token. Add tests.
- [ ] `bench:compare`: time to sources, generation ms per output token and output tokens in the summary and the table. Add tests.
- [ ] README: the timing panel and benchmark sections.
- [ ] Run `bench:compare -- --runs 1` with drafts and write the analysis in the report.

## Decisions

- **Generation is normalised per output token, not length-limited** (owner). Cutting drafts could cut a clause in half. The token counts already exist in `usage.generation.outputTokens`, for the Anthropic and the Claude Code providers alike.
- **The translation is not part of time to sources; it is shown separately** (owner). Time to sources is search plus rerank or judge. The panel and the report still name the translation's time, so the comparison does not hide it.
- **The reference RAG stays as the requirements define it** (owner's question "should it be 100 % LLM?"). The requirements define it as "a simple RAG with embeddings and top-k that uses the same chunks and the same generator". Only its generation is an LLM, as in the main flow.
- **One benchmark run with drafts** (owner). The requirements ask for five runs with the median. One run is about 45 minutes and 1,000 calls on the subscription; five would very likely hit its session limit. The report says it is one run.
- **`sourcesMs` is computed in the backend, once** (default). The panel, the run log and the benchmark all read the same value, rather than each adding the steps up itself.

## Open Questions

- None.
