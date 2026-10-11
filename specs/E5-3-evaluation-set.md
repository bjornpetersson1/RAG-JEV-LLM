# E5-3 · Evaluation set

- **Issue:** [#17](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/17)
- **Labels:** `E5 JEV`
- **Phase:** 5. UI and measurement
- **Depends on:** E4-1 (#11), E4-3 (#13), E5-2 (#16); builds on E4-4 (#14) and E5-1 (#15)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 524 tests (520 backend, 4 frontend) and build exit 0; `eval:run` with `claude-code` evaluated all 20 queries and validated the set against the real database). The `tags+jev` row was answered by the LLM: no `JEV_API_KEY`

## Summary

An evaluation set of 20 queries with marked relevant chunks, a labelling helper, and `eval:run`, which prints precision and recall per search mode and recommends a judge threshold from a sweep. A `claude-code` LLM provider lets the LLM roles run on the owner's Claude Code subscription instead of the paid API, so the evaluation can be run without spending API money.

## Goals

- `eval/queries.yaml`: 20 queries (employment agreement and NDA, free text and template), each with its relevant chunks referenced by document identifier and source reference.
- `eval:label`: lists the candidate chunks for one query (tag search and full-text search) with their text, to mark relevant ones quickly.
- `eval:run`: precision and recall for tag search only, tag search + JEV, tag search + LLM judge, and full-text search only; a threshold sweep; a table in the terminal and a Markdown file in `reports/`.
- The LLM provider `claude-code`, selectable per role in `.env` like `anthropic` and `fake`.

## Non-goals

- The reference RAG and the comparison benchmark (E5-4, postponed).
- Timing measurements: calls through `claude-code` are much slower than the API, so `eval:run` reports relevance, not speed.
- Setting `JUDGE_THRESHOLD` automatically; the recommendation is printed, and the owner changes `.env`.
- Multiple labellers or inter-annotator agreement.
- A live JEV run: there is no `JEV_API_KEY` (see Decisions).

## Acceptance Criteria

1. **20 queries with manually marked relevant chunks exist in the repo.**
   - `eval/queries.yaml` has exactly 20 queries, each with an id, an instruction, an optional template (`employment` | `nda`), and at least one relevant chunk as `{ document, sourceRef }` (e.g. `SFS 1982:80` / `7 §`). At least 8 are employment agreements and at least 8 NDAs; at least 4 use a template.
   - Loading the file validates it: a missing field, a duplicate id or a reference to a chunk that is not in the database is an error naming the query. Tested with a small fixture database.
   - Claude drafts the queries and marks the relevant chunks by reading the candidates `eval:label` lists; the owner reviews the file in the PR. The file's header says so.
   - `npm run eval:label -w backend -- <query id>` prints the candidates (source, tags, start of the text, whether already marked).
2. **Precision and recall are printed for tag search, tag search + JEV, and full-text search only.**
   - For each mode (`tags`, `tags+jev`, `tags+llm`, `fts`) and query: the returned set is the candidates (search-only modes) or the chunks the judge approved (judge modes). Precision = relevant returned / returned (0 when nothing is returned); recall = relevant returned / relevant marked. The table shows per-mode macro averages over the 20 queries; the report file also has per-query rows.
   - Tag search uses the configured query translator; the judge modes use E5-2's `judgeAll` with the cache on, forcing `JUDGE_IMPL` to `jev-with-fallback` and `llm` respectively.
   - The report states which judge actually answered: with no `JEV_API_KEY`, the `tags+jev` row is marked as answered by the LLM fallback.
   - Unit tests with fakes check the metrics on a hand-computed example (including the empty cases) and the table/report output.
3. **A recommended threshold is reported from the sweep.**
   - For each judge mode, thresholds 0.1 to 0.9 in steps of 0.1 are applied to the cached scores (no new judge calls), giving precision, recall and F1 per threshold. The recommended threshold is the one with the highest F1, the lowest on a tie. Tested with fixed scores.
   - The terminal and the report show the sweep and the recommendation.
4. **The `claude-code` provider runs LLM roles without the API.**
   - `LLM_PROVIDER=claude-code` (or `LLM_<ROLE>_PROVIDER=claude-code`) makes that role call the local `claude` CLI in non-interactive mode instead of the Anthropic API; no `ANTHROPIC_API_KEY` is needed for it. The model comes from the role's model setting.
   - The answer is checked against the role's JSON schema like the Anthropic client's; a CLI that is missing, exits non-zero, times out or answers with non-JSON gives a clear error. Each call is logged with role, provider, model and latency.
   - Tests use an injected fake process runner, not the real CLI. `.env.example` and the README document it.
5. **The run and the tests work as specified.**
   - `npm run eval:run -w backend` runs against the local database with `claude-code` as the provider and writes `reports/eval-<timestamp>.md`; this real run is done once and its report committed.
   - `npm test` passes without network access.

## Tasks

- [x] `claude-code` provider: client via the `claude` CLI, config validation, factory wiring, tests, `.env.example`, README.
- [x] Query file format, loader and validation against the database.
- [x] `eval:label` CLI.
- [x] Metrics, the four modes, the sweep, terminal table and report file; `eval:run` CLI.
- [x] Write the 20 queries and mark their relevant chunks.
- [x] Run `eval:run` once with `claude-code` and commit the report.
- [x] Tests per acceptance criterion.

## Decisions

- **References by document identifier + source reference** (owner): stable across re-imports, unlike chunk ids; `source_ref` is unique within a document (migration 0003).
- **Claude labels, the owner reviews** (owner): one labeller plus review in the PR, stated in the file.
- **Run on Claude Code, not the paid API** (owner): a new provider `claude-code` in E1-2's provider union. This expands the issue's scope by the owner's decision. Consequence: no timing from these runs.
- **`tags+jev` without a JEV key runs through the fallback** (default, follows the owner's "no real money now"): the row is clearly marked; the JEV judge itself stays unverified live until a key exists.
- **Recommended threshold = highest F1, lowest on a tie** (owner).
- **Also `tags+llm`** (from the issue's scope): needed for "JEV vs LLM as judge".
- **Macro averages over queries; precision 0 on an empty result** (default): every query weighs the same; an empty answer is penalised in precision as well as recall.
- **YAML parsing** (default): if no YAML parser is in the repo already, the `yaml` package is added as the only new dependency; the issue names the `.yaml` file.

- **Builds on E5-1 and E5-2 as merged** (spec update before implementing):
  - The judge modes build their judge with `createJudging`, with `JUDGE_IMPL` forced per mode, and run E5-2's `judgeAll` with the cache on. The sweep reads the scores in `judgeAll`'s result.
  - Without `JEV_API_KEY`, E5-1 turns `jev-with-fallback` into the LLM judge. `tags+jev` and `tags+llm` then ask the same judge and share its cached scores, and the report says the `tags+jev` row was answered by the LLM.
  - The three tag modes judge or return the candidates of candidate search mode `tags` (E4-3), so they are compared on the same candidates. `fts` uses mode `fts`.
- **`sourceRef` is the stored source reference** (spec update): `chunks.source_ref` already starts with the document identifier, e.g. `SFS 1982:80 4 b §` or `AD 2001 nr 91, Domskäl, del 3/3`. A relevant chunk is therefore `{ document: 'SFS 1982:80', sourceRef: 'SFS 1982:80 4 b §' }`, looked up by both.
- **The `claude-code` provider calls `claude -p`** (checked before implementing): it sends the system prompt, `--json-schema`, `--output-format json`, `--model` and no tools, and reads `structured_output` and `usage` from the JSON result. A trial call took about 4 s. It goes through E1-2's retry and logging wrapper like the Anthropic transport.

- **Code layout** (settled while implementing):
  - `src/llm/claude-code-client.ts` is a single-attempt transport wrapped by E1-2's `withRetryAndLogging`. A non-zero exit or a timeout is retried; a missing CLI, non-JSON output, an error result or missing structured output is not. The process runner is injected for tests (`runProcess` in `LlmDependencies`).
  - `src/eval/`: `queries.ts` (parse and resolve), `metrics.ts`, `run.ts` (`runEvaluation` over injected dependencies), `report.ts`, `label.ts`, `setup.ts` (the real dependencies from `.env`) and `cli.ts`.
  - `writeMarkdownReport` and `escapeCell` moved from the tagging report to `src/reports.ts`, shared with the evaluation report.
- **Each query has a `kind`** (`employment` | `nda`; settled while implementing): this is how the "at least 8 of each" rule is checked. Every query also has free text, because the judges need an instruction to ask about; 6 also choose a template, which adds its preset tags.
- **F1 is the harmonic mean of the macro-averaged precision and recall** (settled while implementing). A query whose judge returned nothing has precision 0.
- **`yaml` 2.9.1 added** to the backend, as the spec allowed: no YAML parser was in the repo.
- **How the labels were made** (settled while labelling):
  - Claude read every candidate `eval:label` listed (39–58 per query, tag search plus full text).
  - It marked the chunks a lawyer drafting that clause would use: the statute provisions that regulate it and the rulings that discuss it.
  - A few central provisions outside the candidates were added by lookup: 36 § and 38 § avtalslagen, and 7, 12 and 18 §§ anställningsskyddslagen.
  - That gives 266 references, 7–29 per query. Recall is therefore measured against one labeller's view, mostly within what the two searches find.

- **Clean code**:
  - The search part of the setup (`createSearchSetup`: translator, candidate search, chunk loading, report settings) is separate from the judges, so `eval:label` builds no judges, and E5-4 can reuse it.
  - Searches take only the query's text (`QueryText`).
  - The per-mode records come from `byJudgeMode` / `byEvalMode`.
  - `toLlmUsage` is shared by the Anthropic and Claude Code clients. `sum` and `mean` are in `stats.ts`.
  - The factory builds the shared client options once.
  - `eval:label` parses its arguments with `node:util` `parseArgs`.
- **Skipped clean-code suggestions**:
  - Running queries, or the two judge modes, in parallel. Without a JEV key the second mode must read the first one's cached scores, and with a key the gain only matters for timing, which this evaluation does not measure.
  - Reusing an LLM fallback score from `tags+jev` as the `tags+llm` judgement. It is only possible with a JEV key, and E5-2 deliberately does not cache fallback answers.
  - A generic "named retrievers" runner for E5-4. `metrics.ts`, `queries.ts` and `createSearchSetup` are already independent of the modes, and E5-4 can reshape the runner when it adds the reference RAG.
  - A shared console logger. Three CLIs have small variants.

- **Code review fixes**:
  - **`claude-code` never bills the API.** The CLI is started without `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, because a key in the environment takes precedence over the Claude Code login. This was confirmed live: a call with an invalid key in the environment succeeded on the subscription. **Before this fix, the 20 `eval:label` translations and a first `eval:run` (stopped after 15 queries) inherited the key from `.env` and were billed to the API, an estimated 0.5 USD with Haiku.** Its judge scores (same model) stay in the judge cache and are reused.
  - The CLI also runs in the system temp directory, so the project's CLAUDE.md cannot reach the prompts.
  - A timed-out process gets SIGTERM, then SIGKILL after 5 s, and the call settles at once. A broken stdin pipe is not an uncaught error.
  - An error result on a non-zero exit (not logged in, unknown model) fails without retrying.
  - Calls through `claude-code` are logged without an API cost estimate (`priced: false`).
  - **Both judge modes use one judgement when they have the same judge** (no JEV key), so their rows agree exactly instead of depending on timeouts twice.
  - **A failing query is listed in the report and left out of the averages, and `eval:run` exits non-zero.** One failure no longer loses the run.
  - A query's `template` must match its `kind`. The LLM config is loaded once for the setup.
  - The README gives the larger judge timeouts a `claude-code` run needs.
- **Not fixed (code review): a tagging run through `claude-code` still stores an API cost estimate in `tagging_runs`.** Tagging with that provider is not a workflow this issue supports; the per-call log is now unpriced.

- **The first run's report is committed as `eval/report-2026-10-11.md`** (settled while verifying): `reports/` is git-ignored, so the copy sits next to the queries it measures. The run used `claude-code` with `claude-haiku-5-5` for the translator and the judge.
  - Tag search: precision 0.213, recall 0.491.
  - Tag search plus judge: precision 0.364, recall 0.473. Without a JEV key, `tags+jev` and `tags+llm` are the same LLM judge.
  - Full-text search: precision 0.205, recall 0.440.
  - The sweep recommends threshold **0.6** for the LLM judge (F1 0.424 against 0.411 at 0.5). `JUDGE_THRESHOLD` is left at 0.5 for the owner to decide, as the Non-goals say.

## Open Questions

- None.
