# E5-3 · Evaluation set

- **Issue:** [#17](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/17)
- **Labels:** `E5 JEV`
- **Phase:** 5. UI and measurement
- **Depends on:** E4-1 (#11), E4-3 (#13), E5-2 (#16); builds on E4-4 (#14) and E5-1 (#15)
- **Status:** Approved

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

- [ ] `claude-code` provider: client via the `claude` CLI, config validation, factory wiring, tests, `.env.example`, README.
- [ ] Query file format, loader and validation against the database.
- [ ] `eval:label` CLI.
- [ ] Metrics, the four modes, the sweep, terminal table and report file; `eval:run` CLI.
- [ ] Write the 20 queries and mark their relevant chunks.
- [ ] Run `eval:run` once with `claude-code` and commit the report.
- [ ] Tests per acceptance criterion.

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

## Open Questions

- None.
