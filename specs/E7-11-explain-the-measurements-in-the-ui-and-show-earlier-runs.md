# E7-11 · Explain the measurements in the UI and show earlier runs

- **Issue:** [#98](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/98)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** none (related: E7-3 (#24), E7-8 (#91), E7-9 (#94))
- **Status:** Approved

## Summary

The web UI says, in plain Swedish for a lawyer, what each number measures, why, and how to read it. It gets a second tab that lists every earlier run from the run log, with filters, and shows each run's timing panel.

## Goals

- **Info texts.** Each section gets one always-visible sentence saying what it shows: the timing panel, the comparison, the draft's post-check and the source list. Each measure gets an (i) button that opens its explanation in place: what is measured, why, and how to read it.
- **Introduction.** A short text above the results says what the comparison is about. The main flow finds sources with tags and the reference RAG with vectors, and both use the same judge and generator.
- **The comparison in words.** The comparison line says which flow had its sources first and what that means. It also says that the UI's numbers are a demo (judge cache on) and that `bench:compare` is the measurement.
- **Earlier runs.** A tab, *Tidigare körningar*, lists every run in `logs/runs.jsonl`, newest first, grouped per request (`runId`). It filters by contract type and flow and is split into pages. Opening a request shows its timing panel and counts as when it ran.

## Non-goals

- Drafts and sources of earlier runs. The run log does not store them, and it is not extended.
- `bench:compare` results (`eval/report-*.md`) in the UI.
- Changing what is measured or how: steps, timings, the judge cache, the run log's format.
- A router library, a tooltip library or any other new dependency.
- Deleting or editing runs, or exporting them.
- Explanations in English. The UI is in Swedish (owner, E7-1).

## Acceptance Criteria

1. **Every measure in the timing panel, the source list and the result view has an info text in Swedish, saying what is measured, why, and how to read it; a frontend test checks that each one has it.**
   - The measures are:
     - each timing row: translation, search, embedding, rerank, time to sources, generation and total;
     - the rerank detail (time per judged candidate, cache hits) and the generation detail (tokens, ms/token);
     - the configuration line;
     - källträffsäkerhet and the flagged references;
     - a source's score and origin;
     - the source groups (cited, sent but not cited, not sent, with their reasons).
   - Each measure has an (i) button, a real `<button>` with an accessible name such as "Vad betyder Tid till källor?". It opens and closes the text in place and works with the keyboard.
   - Each section has one always-visible sentence, and the results have the introduction.
   - The texts are written for a lawyer: a technical term is explained in the same sentence.
   - A frontend test goes through the list above and checks that every measure's button opens a non-empty text.
2. **The comparison line reads the result in words and says that the UI's numbers are a demo (judge cache on) and that `bench:compare` is the measurement.**
   - The line keeps today's numbers. It says which flow had its sources first, without and with the translation, and what the difference consists of (the translation step, the search, the judge).
   - A fixed sentence says that the judge cache is on in the UI, so the reference RAG can reuse the main flow's judgements, and that `npm run bench:compare` is the measurement.
   - Frontend tests cover a main flow that is first and one that is later.
3. **A page lists earlier runs from `logs/runs.jsonl`, newest first, and opening one shows its timing panel; backend and frontend tests with a temporary run log cover it.**
   - `GET /api/runs` returns the requests, newest first. Each request holds its flows' log entries.
   - The endpoint filters by contract type (`template`) and by flow (requests with that flow), and returns pages of 20 with the total count.
   - A line that is not valid JSON is skipped, and so is an entry missing `runId` or `timestamp`. A missing log gives an empty list.
   - The tab *Tidigare körningar* (address `#korningar`) lists:
     - each request's time, contract type and instruction (or the template's default);
     - its flows' time to sources and total;
     - a failed flow's error.
   - The tab has filters and page buttons.
   - Opening a request shows the timing panel with the logged timings, judging and configuration, the counts, and the same info texts.
   - A field an older entry lacks (e.g. `sourcesMs`, `judging`) shows `–`.
   - Backend tests read a temporary run log with a valid line, an invalid line, two flows of one request and both contract types. Frontend tests cover the list, a filter, paging and opening a request, with a faked fetch.
4. **The README's web UI section describes the info texts and the runs page.**
   - It covers the (i) buttons, the runs tab, `GET /api/runs` with its parameters, and the fact that drafts are not kept.
5. **`npm test` runs without network access.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0, with `npm test` offline.

## Tasks

- [ ] Info texts: the texts, an (i) component and the always-visible sentences.
- [ ] The introduction and the comparison line in words, with the demo sentence.
- [ ] Backend: read and group the run log, filters, pages, `GET /api/runs`.
- [ ] Frontend: the tabs with `#` addresses, the runs list with filters and pages, and a request's detail with the timing panel.
- [ ] Tests for every criterion.
- [ ] README.

## Decisions

- **A short sentence per section plus an (i) button per measure** (owner). The panel stays compact, every explanation is one click away, and it needs no dependency.
- **The texts are written for a lawyer or client** (owner): plain words, technical terms explained in the same sentence.
- **Earlier runs come from the run log, with timings and counts only** (owner). The run log stores no drafts or sources, and extending it is a non-goal.
- **Every run, with filters by contract type and flow, in pages** (owner). The page size is 20 (default).
- **Tabs with `#` addresses instead of a router** (default). A router dependency is not worth it for two views.
- **Requests are grouped by `runId`** (default). The flows of one request are shown together, as in the timing panel.
- **The detail view reuses the timing panel** (default). The UI then has one place that formats timings, and the info texts are the same.
- **The run log is read on each request** (default). It is a local file of a few hundred lines; no cache.

## Open Questions

- None.
