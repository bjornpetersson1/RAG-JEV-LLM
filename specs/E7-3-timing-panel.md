# E7-3 · Timing panel

- **Issue:** [#24](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/24)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** E7-1 (#22), E5-4 (#18); after E7-5 (#78), so the panel shows the fast reranker
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 880 tests (827 backend, 53 frontend) and build exit 0; `npm run dev` with fake LLM roles and the real minilm reranker and bge-m3 in headless Chrome: both flows in the panel with bars, the difference and the configuration lines, and two lines with one run id in `logs/runs.jsonl`)

## Summary

A timing panel in the UI shows the time of each step and the total for the main flow, next to the same query run through the reference RAG, with a bar comparison and the active configuration. Every run of the query flow, from the UI or `npm run query`, is logged as one JSON line in `logs/runs.jsonl`.

## Goals

- One timing shape for both flows, collected with `performance.now()` and returned in the result and the stream (E7-1):
  - main flow: query translation, retrieval (embedding the question shown separately when the retriever embeds), rerank (total, per-chunk median for a local or JEV reranker, cache hits for a cached one), generation, total;
  - reference RAG (E5-4): embedding, vector search, generation, total.
- UI panel: the numbers per step for each flow, a horizontal bar per step comparing the two flows on one scale, the total difference ("huvudflödet 42 s snabbare"), and a compact configuration line.
- The reference RAG option in the form is on by default.
- `logs/runs.jsonl`: one line per flow run with the timestamp, source (`api` or `cli`), flow (`main` or `reference`), query and template, configuration, timings, counts (tags, candidates, fallback, approved, sent, cited) and source accuracy.

## Non-goals

- Running the flows in parallel (E7-1: sequentially, so neither distorts the other's timings).
- Aggregating the log into statistics or a dashboard; `bench:compare` (E5-4) is the benchmark.
- Logging `bench:compare` or `eval:run` runs: they have their own reports.
- A chart library: the bars are plain HTML/CSS.
- Rotating or capping the log file.

## Acceptance Criteria

1. **The numbers are shown in the UI.**
   - After a query, the panel shows every step's time in ms or s and the total, for the main flow, and the configuration line (retriever, reranker with model and dtype, query translator, generator model, tag index).
   - A step that did not run (translation with `RETRIEVER=bge`, generation when nothing was approved) shows `–`, not 0.
   - Each step's number appears when its stream event arrives; a frontend test with a stubbed stream checks the numbers, the `–` case and the configuration line.
2. **Each run is logged to a file.**
   - Every main-flow and reference-flow run through `POST /api/query` or `npm run query` appends one JSON line to `logs/runs.jsonl` with the fields above; `logs/` is git-ignored and created when missing.
   - A failed run is logged with its error and the timings it reached.
   - A backend test with fakes runs both flows through the route and the CLI path and parses the lines; a failing log write is reported as a warning and does not fail the query.
3. **The reference RAG timings for the same query are shown next to the main flow.**
   - With the reference option on (the default), the panel shows both flows' steps side by side and the bars on one shared scale, plus the total difference.
   - With it off, only the main flow is shown and the panel says the reference was not run.
   - A frontend test covers both cases.
4. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.
   - A real query on the demo machine through `npm run dev` shows the panel with both flows; a screenshot is in the PR.

## Tasks

- [x] Shared timing and configuration shapes for both flows; per-chunk median and cache hits from the rerank stats.
- [x] Configuration summary from `.env` (retriever, reranker and model/dtype, translator, generator model, tag index).
- [x] Run logger: append JSON lines, create `logs/`, warn on failure; used by the API route and `npm run query`.
- [x] `.gitignore`: `/logs/`.
- [x] Timing panel component with bars and the configuration line; reference option on by default.
- [x] README: the panel and the log format.
- [x] Tests.

## Decisions

- **Sequential flows** (owner, E7-1): main flow first, then the reference RAG.
- **The configuration is shown in the panel** (owner): one compact line, since the times mean little without it.
- **The reference RAG is on by default** (owner): demo step 4 shows it without an extra click; it can be turned off.
- **UI and CLI runs are logged** (owner), with `source` telling them apart; benchmarks are not.
- **"JEV" in the issue is the rerank step** (default): since E8-1 the judge is one of several rerankers, so the step is named after the configured reranker.
- **One line per flow run** (default): a run with the reference RAG gives two lines with a shared run id, so either flow can be read alone.
- **Precision and recall are not logged** (default): a UI query has no labels; `bench:compare` reports them for the evaluation queries.

- **Builds on E7-1, E7-2, E5-4 and E7-5 as merged** (spec update before implementing):
  - **The timings are `QueryResult.timings`** (E5-4/E7-1): each step's time, absent when the step did not run, so the panel shows `–` for it. The step events already carry each step's time as it finishes.
  - **"Per chunk" is the rerank time divided by the candidates it scored** (`judging.judgeCalls`), an average: the rerank stats hold the total time, not one time per chunk. Cache hits come from the rerank stats (`judging.cacheHits`).
  - **The configuration travels with the flow**: each flow's steps carry a description (retriever, reranker with model and dtype, query translator, generator, tag index; for the reference RAG the embedder and k), sent in the stream's `start` event and kept in the result and the log.
  - **One runner logs both callers**: a wrapper around `runQuery` collects the step events, then appends the run's line (or, on failure, the error and the timings it reached); the route and `npm run query` both use it.
  - **The counts come from the sources' status** (E7-2): sent is `cited` + `sent`, cited is `cited`. The default reranker is now `minilm` (E7-5).

- **Settled while implementing**:
  - **`FlowConfiguration`** (`generation/flow-configuration.ts`) is built with each flow (`createQueryFlow`, `createReferenceFlow`), sent in the `start` event and kept in the log, and formatted once for the benchmark's table (`formatConfiguration`), which replaced its own strings. A retriever that embeds names its embedder. (The result does not repeat it: nothing reads it there.)
  - **Each step event carries its part of the result's `timings`** (clean code): `runQuery` collects the result's times from the same slices it reports, `runAndLog` merges the slices a failed run reached, and the panel merges them while a flow runs, so the step-to-time mapping lives in one place per package.
  - **`runAndLog`** (`generation/run-log.ts`) wraps `runQuery` for the route (`source: 'api'`, one `runId` per request) and `npm run query` (`source: 'cli'`). A flow that cannot even be built (the reference RAG without embeddings) is not a run and is not logged; the stream reports it.
  - **The panel is a table**: one row per step, one column per flow, the time over a bar whose width is the time divided by the largest time shown, so both flows share one scale. Times under a second are in ms, others in seconds with one decimal and a decimal comma.
  - **`…` for a step still running, `–` for one the flow does not run** (from the backend's plan) or skipped (a result without its time).

- **Code review fixes**:
  - **After the query ends, a step without a time shows `–`**: a failed or broken-off run no longer leaves `…` behind.
  - **The server loads the local models before it listens** (`QueryFlows.warmUp`): the reranker, and the embedder and vectors when the reference RAG can be built, so the first query's timings, and the panel's difference, do not include a model load.
  - **A flow that cannot be built is skipped, not failed** (`{ type: 'skipped' }`): with the reference RAG on by default and no embeddings yet, the main flow's result stands and the panel says why the reference was not run, instead of an error alert on every query.
  - **The rerank's per-candidate time is per candidate scored** (`judgeCalls`, cache hits left out), shown as `<1 ms` when it rounds to nothing.
  - **The run log**: a finished run is logged once, outside the error path; `defaultInstruction` is logged when it was used; the folder is created on the first write. `RunLog.append` must not throw (`createRunLog` warns).
  - **`runQuery` fills a caller's `reached` timings** (`QueryOptions.reached`), so `runAndLog` needs no second mapping from step events.
  - **The configuration names the embedder only when the dense half runs**, and the tag index's label comes from the index in use.
- **Not changed (code review)**: **an asynchronous log write**: one line of about a kilobyte per run, written synchronously after a query that takes seconds.

## Open Questions

- None.
