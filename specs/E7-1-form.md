# E7-1 · Form

- **Issue:** [#22](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/22)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** E1-1 (#1), E6-2 (#20), E4-4 (#14); uses E5-4 (#18) for the reference option
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 826 tests (803 backend, 23 frontend) and build exit 0; `npm run dev` with fake LLM roles and the real BGE reranker: both form paths, with and without the reference RAG, run end to end in headless Chrome)

## Summary

The React UI gets a form: a required contract type (employment agreement or NDA) and an optional free-text instruction. Submitting calls `POST /api/query`, which runs the query flow from E6-2 and streams one event per step, so the UI shows the query's tags, the candidate count (and how many came from the full-text fallback) and the approved count as soon as each is known, then the draft. An option also runs the reference RAG (E5-4) after the main flow.

## Goals

- Contract type selector: `anställningsavtal` / `sekretessavtal` (required), and a Swedish free-text field (optional).
- `POST /api/query` in the backend: validates the request, runs the main flow and, if asked, the reference flow, and streams the steps as newline-delimited JSON.
- The UI shows, per flow: the tags (main flow only), the number of candidates and how many came from the fallback, the number approved, and the draft as plain text when it arrives.
- A loading state per step, and every backend error shown to the user.
- Tests: backend route tests with fake LLM roles and a fake embedder; frontend tests with a stubbed `fetch`.

## Non-goals

- Rendering the draft with clickable citations, the source list and the flagged references: E7-2. E7-1 shows the draft as preformatted text.
- The timing panel and `logs/runs.jsonl`: E7-3. The streamed events already carry the step timings, so E7-3 only displays and logs them.
- Choosing the contract type from the free text with an LLM (owner: the type is required).
- Cancelling a running query, query history, or more than one query at a time.
- Changing the CLI `npm run query`.
- Styling beyond a clean, readable layout; no UI library.

## Acceptance Criteria

1. **Template selection and free text both start the same flow.**
   - With only a contract type chosen, submitting runs the flow with the template's preset tags; with free text as well, the translated tags are added (E4-4). Both go through the same `runQuery` and the same endpoint.
   - Without free text, the flow uses a fixed Swedish instruction per template (e.g. "Anställningsavtal") for reranking, embedding and generation, since those need a question; the UI shows that this text was used.
   - Submitting without a contract type is not possible in the UI, and the endpoint answers 400 with a message.
   - A frontend test submits both paths and asserts the request body; a backend test runs both through the route with fakes and gets a draft.
2. **Tags, candidate count and approved count are shown.**
   - The UI lists the tags (preset and translated marked differently), the number of candidates with the fallback share ("30 kandidater, varav 6 från fritextsökning"), and the number approved by the reranker.
   - Each number appears as soon as its step's event arrives, before the draft; a frontend test streams the events one by one and checks this.
   - With the reference option on, the reference flow's candidates and chunks sent are shown in their own section after the main flow's draft.
3. **Errors from the backend are shown to the user.**
   - A 4xx/5xx answer, an `error` event in the stream, a broken stream and an unreachable backend each show a Swedish error message with the backend's text where there is one; tests cover all four.
   - A second query while one is running answers 409 and the UI says a query is already running.
4. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.
   - `npm run dev` with fake LLM roles: the form runs a query end to end in the browser; a screenshot is in the PR.

## Tasks

- [x] `runQuery` reports each step through an optional callback (translation, retrieval, rerank, generation) without changing its result; the reference flow (E5-4) runs through `runQuery` too, so it reports its steps the same way.
- [x] Server: build the query flow and the reference flow at startup; `POST /query` (served at `/api/query` through the Vite proxy) with request validation, NDJSON streaming, a one-at-a-time guard and error events.
- [x] Default instruction per template when the free text is empty.
- [x] Frontend: form, streaming client, step state, result sections, error display; Swedish texts.
- [x] README: the UI, the endpoint and its events.
- [x] Tests.

## Decisions

- **Contract type required, free text optional** (owner): the generator needs a prompt template, and "template or free text" in the demo means the template alone or with an instruction. Choosing the type from free text would cost an extra LLM call.
- **A fixed instruction when the free text is empty** (default): the reranker, the embedder and the generator all need a question; the preset tags alone give candidates but nothing to rank them against.
- **Streaming, one JSON line per step** (owner): an answer takes 1–2 minutes, and the demo's step 2 (tags, candidates, approved) should show before the draft. `fetch` with a streamed body reads it; no SSE library and no new dependency.
- **Main flow first, then the reference flow, never in parallel** (owner): on four cores the BGE rerank and the embedder would compete and distort E7-3's comparison.
- **Swedish UI texts** (owner): the users, sources and drafts are Swedish. This departs from `CLAUDE.md`'s "everything committed is in English" for user-facing UI strings only; code, comments and tests stay English.
- **One query at a time, 409 otherwise** (default): the flow is CPU-bound on the demo machine, and two runs would distort each other's timings.
- **The flows are built at startup, the models load on the first query** (default): as `npm run query` does today; the first query's embedding time includes the model load, as the README already says for `retrieve`.
- **The endpoint lives in E7-1** (owner, E5-4): one place for the API, with the reference flow as an option.

- **Builds on E5-4 as merged** (spec update before implementing): the reference RAG is a set of query-flow steps that `runQuery` runs (`createReferenceFlow`), so one step callback in `runQuery` covers both flows. `QueryResult` leaves out steps that did not run (`judging`, `translationMs`, `embeddingMs`, `judgingMs`) and lists the `approved` chunks; the stream's events follow that shape. The candidate's origin (`tag`, `fts`, `dense`, …) gives the fallback count.

- **Settled while implementing**:
  - **The default instruction lives in `runQuery`** (`DEFAULT_INSTRUCTIONS`): with an empty instruction, translation still gets the empty text (so only the presets are used) and every later step gets the default. `QueryResult.defaultInstruction` says when it was used, and `QueryResult.fallback` counts the full-text candidates.
  - **Step events** (`QueryStep`): `translation`, `search`, `rerank` and `generation`, each sent after its step and only for the steps the flow has. The draft itself comes in the `result` event with the whole `QueryResult`, which E7-2 renders.
  - **The route is registered only when the app gets flows** (`buildApp({ queryFlows })`), so the health tests and other uses of the app need no database. The server opens the database (and migrates it) and builds the flows at startup, with a quiet console logger as the CLI uses. A startup failure prints its message and exits.
  - **The reference option is off by default here**; E7-3 turns it on.
  - **Each flow starts with a `start` event listing the steps it will run** (`plannedSteps`), so the UI shows the right step as running, e.g. no translation with `RETRIEVER=bge` and no rerank for the reference RAG. It does not have to know each flow's configuration.
  - **Both flows share one load of the embedder and vectors** in the server (`createQueryFlows`), loaded at startup when `RETRIEVER` needs them, otherwise with the first reference query.
  - **One template check** (`assertTemplate`) replaces the three copies in the query translation, the prompt templates and the default instruction.
  - **The UI shows tag slugs**, marked _mall_ or _översatt_; the vocabulary's labels are not sent.
  - **The frontend mirrors the event types** (`frontend/src/query.ts`) instead of importing them from the backend (clean code suggested a shared module): the backend types reach Node-only modules (`node:sqlite`, the LLM clients) that the browser build cannot type-check.
- **Code review fixes**:
  - **A client that goes away stops the query** before its next step (`QueryOptions.signal`, aborted when the response closes unfinished), so a closed tab no longer holds the one-query lock for the rest of the run.
  - **The default instruction is the contract itself** ("Anställningsavtal", "Sekretessavtal"): a generic word such as "upprätta" would match unrelated chunks in the full-text fallback and the BM25 half.
  - **The server never creates or migrates the database**: without one it starts without `POST /query` and warns. The flows share the server's tag index, so it is built once and disposed on close. The flows' own startup check replaces `checkRetrieverReady`, which is removed with its tests (`createQueryFlows` failing on missing embeddings is tested instead).
  - **The UI says the reference RAG is being prepared** between the main flow's result and the reference RAG's start, while the server loads the embedder and vectors.
  - **The stream reader is released** however reading ends, and a line that is not JSON is reported as an invalid answer, not as a broken-off one.
- **PR review fix**: **a database with pending migrations is treated like a missing one** (`openQueryDatabase`): the server starts without `POST /query` and warns naming `npm run db:migrate`, instead of stopping on a missing table. Checked by starting the server without a database (404 on `POST /query`, 200 on `/health`, no file created).
- **Not changed (code review)**: **recording the Swedish UI strings as an exception in `CLAUDE.md`**. The exception is the owner's decision in this spec; changing `CLAUDE.md` is left to the owner.
- **Skipped clean-code suggestions**:
  - **Moving the default instructions into the prompt files**: `runQuery` would then read a prompt file before translation; two sentences in code are simpler.
  - **A shared flow runner for the route and the CLI, and one timing shape for step events**: E7-3 adds the run log and the timing panel and decides there.
  - **Dropping the server's separate tag index (`app.tagIndex`)**: unused by the query flow, but it predates this issue and is out of its scope.

## Open Questions

- None.
