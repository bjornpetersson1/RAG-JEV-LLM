# E6-2 · Generator

- **Issue:** [#20](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/20)
- **Labels:** `E6 Generation`
- **Phase:** 4. Judging and generation
- **Depends on:** E6-1 (#19), E5-2 (#16)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 593 tests (589 backend, 4 frontend) and build exit 0; demo runs on claude-code for both templates saved in `prompts/examples/`; CLI usage errors exit 1)

## Summary

The `Generator` role drafts an employment agreement or NDA from the lawyer's instruction and the approved chunks, using the E6-1 templates, and returns the draft with its cited sources mapped from the inline `[K:<chunk-id>]` citations. A `query` CLI runs the whole flow — query translation → candidate search → JEV judging → draft — in the terminal and prints the draft, its sources and the time per step (the phase 4 milestone).

## Goals

- The LLM-backed generator renders the E6-1 template for the requested template id, calls the configured generator model, and returns the Markdown draft and token usage.
- Context assembly: the approved chunks ordered by judge score (highest first), each with id and source reference, capped by a maximum number of chunks and a maximum number of context characters, both configurable.
- Citation parsing: every `[K:<chunk-id>]` in the draft is found and mapped to the chunk's source reference.
- A generation result with: the draft text; the used sources (chunk id, source reference, text) in order of first citation; the submitted-but-unused chunks; the approved chunks left out by the context limits; timing; token usage.
- A query flow that chains the existing steps (E4-4 translation, E4-1/E4-3 candidate search, E5-2 `judgeAll`) with generation, reusable by the UI (E7-1) and with the generation step reusable by the reference RAG (E5-4).
- A `query` CLI: `npm run query -- "<instruction>" --template employment|nda [--max-chunks <n>] [--max-context-chars <n>]`.
- When the context limits leave approved chunks out, the result says so (which limit, how many chunks) and the CLI tells the user, with the command to run again with a larger context.
- Example drafts for both templates made with a real LLM and saved in `prompts/examples/` (moved here from E6-1).

## Non-goals

- Streaming the draft to the CLI or UI.
- Flagging citations to chunks that were not submitted, and checking free-text legal references: E6-3. E6-2 leaves the draft text unchanged and only keeps valid citations in the source list.
- An HTTP route or UI for the flow: E7-1.
- The reference RAG: E5-4.
- Naming the parties from the CLI; the template's default fictional parties are used.
- Persisting drafts or query runs in the database.
- Caching drafts.

## Acceptance Criteria

1. **Every reference in the draft points to a chunk that was sent in (with a real LLM on a demo query, and enforced in tests with a fake).**
   - The used-sources list only contains chunks that were in the generator's context. A test with a fake generator that cites a submitted id, an approved-but-not-submitted id (cut by the limits) and an unknown id shows only the submitted one in the used sources, the draft text unchanged, and the other submitted chunks under unused.
   - Citation parsing is tested on its own: several citations in one bracket group or in a row, repeated citations (listed once, in order of first citation), and text without citations.
   - Demo: one `query` run per template with the `claude-code` provider (the subscription, no API key reaching the `claude` process) produces a draft in which every `[K:…]` citation is a submitted chunk; the CLI reports zero citations outside the submitted set. The runs are saved as `prompts/examples/employment.md` and `prompts/examples/nda.md` (instruction, draft, sources, timing).
   - Both example drafts contain a heading for every required section of their template (E6-1) and use fictional parties; checked by reading the examples and recorded in Decisions.
2. **The CLI runs query → tags → candidates → JEV → draft and prints draft, sources and time per step.**
   - `npm run query -- "<instruction>" --template employment` prints the query tags, the number of candidates, the number of approved and submitted chunks, the draft, the used sources (citation id, source reference), the unused sources, and the elapsed ms for translation, search, judging, generation and total, plus token usage per LLM step.
   - A missing or unknown `--template`, or a missing instruction, prints a usage message naming the valid templates and exits non-zero.
   - A flow test with fakes (fake roles, fake judge, test database) runs the whole chain and asserts the result shape, the step timings and that judging received the search's candidates.
   - When no chunk is approved, the flow stops before generation and the CLI prints that no relevant sources were found, with the timings so far, and exits 0 (tested; the generator is not called).
3. **Context respects the configured limits.**
   - `GENERATOR_MAX_CHUNKS` (positive integer, default 20) and `GENERATOR_MAX_CONTEXT_CHARS` (positive integer, default 60000) are validated at startup with a clear error and documented in `.env.example`.
   - Chunks are taken by descending judge score (input order on ties); a chunk whose text would exceed the character budget is skipped and later, smaller ones may still fit; no more than the chunk limit is sent. Tests cover both limits, the ordering and the left-out list.
   - The result reports whether the context was limited, which limit(s) left chunks out, and how many approved chunks were left out (tested).
   - When chunks were left out, the CLI prints a notice after the draft naming the limit and the number of chunks left out, and the same command with `--max-chunks` / `--max-context-chars` raised enough to include all approved chunks. Those flags override the `.env` limits for one run; an invalid value prints the usage message and exits non-zero (tested).
4. **The checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 with no network access.

## Tasks

- [x] Update the `Generator` role: input takes the template id, instruction, chunks and optional parties; output is the draft text and usage. The LLM-backed generator renders the E6-1 template and asks only for the draft text; the fake generator writes a deterministic Markdown draft citing every chunk as `[K:<id>]`.
- [x] Citation parser and source mapping (used, unused).
- [x] Context selection with the two limits; generator config (`GENERATOR_MAX_CHUNKS`, `GENERATOR_MAX_CONTEXT_CHARS`) loaded and validated at startup; `.env.example`.
- [x] The generation step (context → generator → citations → result) as its own function, so E5-4 can call it with its own chunks.
- [x] The query flow in `backend/src/generation/`, built on the existing search setup (translation, candidate search, chunk loading) and `judgeAll`, with timing and usage per step.
- [x] `query` CLI in the backend, with `--max-chunks` / `--max-context-chars` and the limited-context notice, and the root `npm run query` script; README section.
- [x] Demo runs with `claude-code` for both templates; save `prompts/examples/employment.md` and `prompts/examples/nda.md`.
- [x] Tests for every acceptance criterion.

## Decisions

- **No streaming** (owner): the draft is returned when finished; the LLM clients have no streaming (E1-2), and citations are parsed on the whole text. Can be added for the UI (E7).
- **Context limits 20 chunks / 60 000 characters** (owner): roughly 15k tokens of sources; configurable in `.env`.
- **The user is told when the limit is reached and can raise it** (owner, spec review): the result marks a limited context so the UI (E7-1) can show it too; the CLI prints a notice with a ready-made command using `--max-chunks` / `--max-context-chars`, which override the `.env` limits for that run. Running it again repeats the whole flow; cached judge scores (JEV, or the LLM with `JUDGE_IMPL=llm`) are reused, but LLM fallback answers are not cached and an LLM translator may pick other tags, so the rerun can differ slightly (corrected in code review). No interactive prompt, so the CLI stays scriptable.
- **Stop when nothing is approved** (owner): no draft without source support; the CLI says so and shows the timings.
- **Template ids `employment` and `nda`** (owner, see E6-1): `--template` takes the existing `TEMPLATES` ids, which also select the tag presets in query translation.
- **Example drafts here instead of E6-1** (owner, see E6-1): they need the working generator.
- **Citations parsed from the text** (default): the model writes `[K:<id>]` inline as E6-1's templates require, and the draft is the only output (the structured `references` array from E1-2's placeholder is dropped). One source of truth for what is cited, and E6-3 checks the same text.
- **Invalid citations are left in the text** (default): E6-2 only keeps valid ones in the source list; E6-3 flags the rest.
- **Disclaimer enforced in code** (default): if the model omits the template's disclaimer line, it is appended to the draft, so every draft carries it.
- **Demo runs on `claude-code`** (default, owner rule from E5-3): real LLM runs go through the subscription, never the paid API; the run is checked to not pass an API key to `claude`. Without a JEV key, `jev-with-fallback` judges with the LLM, as in E5-3; the examples say which judge answered.
- **Candidate mode `tags+fts`** (default): the search's default mode and the one the UI will use; the CLI does not add a mode flag.
- **Exit code 0 when nothing is approved** (default): it is a valid outcome, not an error.
- **Code in `backend/src/generation/`** (default), next to the E6-1 template loader.
- **Generator role output is the text and usage** (implementation): `Draft` is `{ text, usage }` and `GenerateInput` gained optional `parties`; the LLM generator renders the E6-1 template and asks only for `text`. The fake generator writes a Markdown list citing every chunk as `[K:<id>]`, and its answer function now returns the text.
- **Generation result** (implementation): `generateDraft` returns the text, `used` (in order of first citation), `unused`, `leftOut`, `outsideCitations` (cited ids that were not submitted, for the CLI's count until E6-3 adds flags), the context report (limits, `limitedBy`, `needed`), time and usage. `runQuery` adds tags, counts, per-step timings and usage per LLM step.
- **Shared query services** (implementation): the translator, candidate search and chunk loading that `eval/setup.ts` built are moved to `query/services.ts` and used by both the evaluation and the query flow, so the two cannot drift apart; the evaluation's behaviour is unchanged (its tests pass as before).
- **Disclaimer match ignores Markdown emphasis** (implementation): a draft that ends with the disclaimer's words without the surrounding `_` is not given a second copy.
- **Demo run settings** (implementation): `LLM_PROVIDER=claude-code` with `ANTHROPIC_API_KEY=sk-ant-invalid-test` in the environment (both runs succeeded, so no API key reached `claude`), query translator and judge `claude-haiku-5-5`, generator `claude-sonnet-5-5`, `JUDGE_IMPL=llm` to reuse the E5-3 evaluation's cached LLM scores (equivalent to `jev-with-fallback` without a JEV key). The instructions are the evaluation queries `anst-01` and `nda-01`.
- **Example check** (manual, AC1): `prompts/examples/employment.md` has a `##` heading for all ten employment sections, `prompts/examples/nda.md` for all seven NDA sections; both use the templates' fictional default parties and `[…]` placeholders for missing details; the CLI reported 0 citations outside the submitted chunks in both (9 of 16 and 18 of 20 submitted chunks cited). The NDA run also shows the context-limit notice (25 approved, 20 submitted).
- **No approved chunk fits the limits** (code review): `generateDraft` does not call the generator when nothing fits the character budget; the result has no `text`, and the CLI says so and prints the limit notice with the rerun command instead of failing on the empty context.
- **The disclaimer must end the draft** (code review): it is appended unless the draft ends with it (emphasis ignored), not merely when it appears somewhere.
- **LLM roles built once for the flow** (code review): `createQueryFlow` builds the roles once and passes them to the query services and the generator; `createJudging` still builds its own judge from the same `llmConfig`, which keeps the judge and its cache key tied to one config (E5-2).
- **Shared shapes** (code review): `ContextReport` reuses `ContextSelection`'s fields, `QueryRequest` is `DraftRequest` without the chunks, and `roleLabel` moved next to `roleModel` in `llm/config.ts`. The limit notice uses the singular for one chunk.
- **Generator keeps its domain input** (code review finding declined): the review suggested that `generateDraft` render the template and pass `{ system, prompt }` to the role, so `llm/` would not import `generation/templates.ts`. The role keeps the spec's input (template id, instruction, chunks, parties), like the other roles whose prompts are built inside `llm/roles.ts`; the fake generator needs the chunks to cite them, and E5-4 calls `generateDraft`, not the role. The second template load is a cache hit (`loadPromptTemplate` keeps each file).
- **Examples are not formatted by Prettier** (implementation): `prompts/examples/` is in `.prettierignore` so the drafts stay exactly as the model wrote them.
- **Builds on what E6-1 delivered** (spec update after E6-1 merged): templates are rendered with `loadPromptTemplate` / `renderPromptTemplate` (which require at least one chunk, consistent with stopping when nothing is approved), citations are parsed with E6-1's `findCitations` (one entry per id, groups such as `[K:12, K:40]` included), and the disclaimer line to enforce is the template's `disclaimer` part. The placeholder chunk formatting in `llm/roles.ts` is removed with the placeholder generator.

## Open Questions

- None.
