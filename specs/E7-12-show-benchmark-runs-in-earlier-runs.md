# E7-12 · Show benchmark runs in earlier runs

- **Issue:** [#103](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/103)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** E7-11 (#98, closed) (related: E5-4 (#18), E9-1 (#101, PR #102))
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 1050 tests (940 backend, 110 frontend; `npm test` offline under sandbox-exec, loopback only) and build exit 0; `GET /runs` also checked against the real `logs/runs.jsonl`: its 20 older `api` requests list as before)

## Summary

`bench:compare` writes every flow run to the run log (`logs/runs.jsonl`) with `source: "bench"`, so benchmark runs show under _Tidigare körningar_ next to the UI's and `npm run query`'s, and the runs list shows and filters on where each request came from.

## Goals

- Every `bench:compare` flow run (main flow and reference RAG, per query and run) appended to the run log through the existing `RunLog`, in the existing entry format.
- The two flows of one query and run share one `runId`.
- A benchmark entry also says which evaluation query and which run it was.
- `GET /api/runs` filters on source; the UI shows and filters on it, in Swedish.

## Non-goals

- `eval:run` and the probes (`subq:probe` etc.): they do not run the query flow, so they stay out of the run log.
- Back-filling the run log from earlier `eval/report-*.md` files.
- A flag to turn benchmark logging off (owner: always log).
- Logging drafts or sources (the run log keeps neither, as before).
- Changing the report `eval/report-<date>.md` or the benchmark's measures.

## Acceptance Criteria

1. **After `bench:compare -- --runs 2 --limit 1` against fakes, the run log has 4 entries (2 flows × 2 runs), each with `source: "bench"`, and the two flows of each run share a `runId`.**
   - The two runs have different `runId`s.
   - Each entry has `bench: { queryId, run, runs }` with the evaluation query's id, the run (from 1) and the run count (2).
   - Each entry's `configuration`, `timings`, `counts`, `judging` and `sourceAccuracy` come from the same `QueryResult` the benchmark measures (logged through `runAndLog`).
   - Proved by a backend test that runs the benchmark's flows from `createBenchSetup` (fake embedder, LLM and judge, temp database) through `benchCompare` with a temp run log.
2. **`GET /api/runs?source=bench` returns only benchmark requests, and a request without `source` filter still returns every source.**
   - `source` accepts `api`, `cli` or `bench`; anything else gives 400 with a message, like `template` and `flow`.
   - `source` combines with `template`, `flow` and `page`.
   - Proved by tests in `backend/src/api/runs-route.test.ts`.
3. **The runs list shows each request's source and filters on it.**
   - Each list row shows the source as "UI", "Terminal" or "Benchmark"; the detail view shows it too, and for a benchmark request the evaluation query and run (e.g. "q03, körning 2 av 5").
   - A "Källa" filter next to the contract type and flow filters, with "Alla" and the three sources; changing it goes back to page 1 and sends `source` to the backend.
   - Proved by tests in `frontend/src/RunsPage.test.tsx`.
4. **A log line written before this change (`api` or `cli`) still lists as before.**
   - An `api` and a `cli` line without `bench` parse, list, and filter by `source=api` / `source=cli`; a line with no `source` at all still parses and lists without a filter (as today).
   - Proved by tests in `run-log.test.ts` / `runs-route.test.ts`.
5. **A run log that cannot be written gives a warning and the benchmark goes on.**
   - With a log path that cannot be written, `bench:compare`'s flows still return their results, every run is measured, and a warning is passed to the warn function.
   - Proved by a backend test.
6. **A failed bench run is logged with its error.**
   - A flow that throws in the benchmark appends an entry with `source: "bench"`, its `error` and the timings it reached; the benchmark counts it as a failure as before.
   - Proved by a backend test.
7. **README updated.**
   - The run log section names `bench` as a source and the `bench` field; the line saying only the UI and `npm run query` write to the log names `bench:compare` too; the _Tidigare körningar_ paragraph mentions the source column and filter.
8. **`npm test` runs without network access.**
   - The canonical checks pass: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.

## Tasks

- [x] `RunSource` gets `'bench'`; `RunLogEntry` gets an optional `bench: { queryId: string; run: number; runs: number }`; `LoggedRun` can carry it to the entry.
- [x] `benchCompare` gives each query and run one `runId` and passes it (with the query id, run and run count) to each flow's `run`.
- [x] `createBenchSetup` runs each flow through `runAndLog` with a `RunLog` (default: `createRunLog` on `RUN_LOG_PATH` warning to stderr; injectable for tests).
- [x] `GET /runs` takes an optional `source` filter (a request matches on its first flow's source).
- [x] Frontend: `RunLogEntry.source` and `bench` types, `RunsFilter.source`, `fetchRuns` sends it; Swedish source labels; source in list row and detail view; "Källa" filter.
- [x] Tests for criteria 1–6.
- [x] README: run log, runs list and source line.

## Decisions

- **Benchmark entries carry `bench: { queryId, run, runs }`** (owner): so a given evaluation run can be found in the list; optional, so older lines are unaffected. `run` counts from 1 in the log, as shown to the user.
- **Always log, no opt-out flag** (owner), as the issue says.
- **Source shown in each list row and in the detail view, plus a "Källa" filter** (owner).
- **Labels:** `api` → "UI", `cli` → "Terminal", `bench` → "Benchmark", as in the issue.
- **The `runId` is made by `benchCompare` per query and run**, so the two flows of one pair share it whatever order they run in; it is passed to `BenchFlow.run`.
- **Logged through the existing `runAndLog`**, so the logged configuration, timings, counts, judging and source accuracy are those of the `QueryResult` the benchmark measures, and a failed run is logged with its error and reached timings exactly as the query flow already does.
- **A request matches a source filter when any of its flows has that source** (code review): both flows of a request are written by one caller, but matching on any flow does not depend on which line comes first.
- **A request's flows are listed main flow first** (code review): `bench:compare` alternates which flow runs first, so log order would put the reference RAG first in half the benchmark rows.
- **A benchmark list row shows its query and run in the source tag** (code review), e.g. "Benchmark (q03, körning 2 av 5)", so a given evaluation run can be found without opening rows; this goes beyond criterion 3's "UI"/"Terminal"/"Benchmark" only by adding the query and run.
- **The logged `template` is the query's contract type (`query.kind`), not kept from code review**: it is the `template` the benchmark's `QueryRequest` runs with (the prompt template the draft is written from), the same field the UI and `npm run query` log. Only the main flow's translation gets the query's own chosen template (E5-3), which the run log has no field for today; adding one is out of scope.
- **`GET /runs` still reads the whole log on every call, not changed from code review**: E7-11 chose that for a local file. `bench:compare` makes the log grow faster (about 200 lines per full run), but at that size reading it takes milliseconds; caching or a tail read is a follow-up if it ever matters.
- **An entry without `source`** (none should exist, but `readRunLog` does not require it today) still lists without a filter and matches no source filter.

- **`createBenchSetup` takes the `RunLog` as an optional last parameter** (default `createRunLog` on `logs/runs.jsonl`, warning with `console.warn`, as `npm run query` does), so tests write to a temporary log and never to the real one.
- **The `runId` is a `randomUUID()`**, as the UI and `npm run query` make theirs; `BenchFlow.run` now gets `{ draft, runId, run, runs }` (`BenchRunOptions`).
- **The source shows as a small tag at the start of each list row** (the existing `.tag` style) and as a "Källa:" line in the detail view.

## Open Questions

- None.
