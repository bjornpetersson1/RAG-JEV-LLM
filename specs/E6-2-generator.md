# E6-2 · Generator

- **Issue:** [#20](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/20)
- **Labels:** `E6 Generation`
- **Phase:** 4. Judging and generation
- **Depends on:** E6-1 (#19), E5-2 (#16)
- **Status:** Approved

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

- [ ] Update the `Generator` role: input takes the template id, instruction, chunks and optional parties; output is the draft text and usage. The LLM-backed generator renders the E6-1 template and asks only for the draft text; the fake generator writes a deterministic Markdown draft citing every chunk as `[K:<id>]`.
- [ ] Citation parser and source mapping (used, unused).
- [ ] Context selection with the two limits; generator config (`GENERATOR_MAX_CHUNKS`, `GENERATOR_MAX_CONTEXT_CHARS`) loaded and validated at startup; `.env.example`.
- [ ] The generation step (context → generator → citations → result) as its own function, so E5-4 can call it with its own chunks.
- [ ] The query flow in `backend/src/generation/`, built on the existing search setup (translation, candidate search, chunk loading) and `judgeAll`, with timing and usage per step.
- [ ] `query` CLI in the backend, with `--max-chunks` / `--max-context-chars` and the limited-context notice, and the root `npm run query` script; README section.
- [ ] Demo runs with `claude-code` for both templates; save `prompts/examples/employment.md` and `prompts/examples/nda.md`.
- [ ] Tests for every acceptance criterion.

## Decisions

- **No streaming** (owner): the draft is returned when finished; the LLM clients have no streaming (E1-2), and citations are parsed on the whole text. Can be added for the UI (E7).
- **Context limits 20 chunks / 60 000 characters** (owner): roughly 15k tokens of sources; configurable in `.env`.
- **The user is told when the limit is reached and can raise it** (owner, spec review): the result marks a limited context so the UI (E7-1) can show it too; the CLI prints a notice with a ready-made command using `--max-chunks` / `--max-context-chars`, which override the `.env` limits for that run. Running it again repeats translation, search and judging, but the judge cache (E5-2) makes judging free; no interactive prompt, so the CLI stays scriptable.
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
- **Builds on what E6-1 delivered** (spec update after E6-1 merged): templates are rendered with `loadPromptTemplate` / `renderPromptTemplate` (which require at least one chunk, consistent with stopping when nothing is approved), citations are parsed with E6-1's `findCitations` (one entry per id, groups such as `[K:12, K:40]` included), and the disclaimer line to enforce is the template's `disclaimer` part. The placeholder chunk formatting in `llm/roles.ts` is removed with the placeholder generator.

## Open Questions

- None.
