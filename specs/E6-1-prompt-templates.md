# E6-1 · Prompt templates

- **Issue:** [#19](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/19)
- **Labels:** `E6 Generation`
- **Phase:** 4. Judging and generation
- **Depends on:** E1-2 (#2)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 556 tests (552 backend, 4 frontend) and build exit 0); the real-LLM example drafts are verified in E6-2

## Summary

Two prompt templates, one for employment agreements (`employment`) and one for NDAs (`nda`), stored as versioned files in `prompts/`, plus a small loader that reads a template and fills its slots (`{{instruction}}`, `{{chunks}}`, `{{parties}}`). The templates fix the required contract sections, the inline citation format `[K:<chunk-id>]` that E6-2 and E6-3 parse, the placeholder convention for missing details and the not-legal-advice disclaimer.

## Goals

- `prompts/employment.md` and `prompts/nda.md`, written in Swedish, each with a system part and a user part.
- Required sections per template:
  - employment agreement: parter, anställningsform, provanställning, arbetsuppgifter, lön, arbetstid, semester, uppsägning, konkurrensklausul, sekretess;
  - NDA: parter, definition av konfidentiell information, undantag, användning, giltighetstid, vite/skadestånd, tillämplig lag och tvist.
- Slots `{{instruction}}`, `{{chunks}}` (each chunk rendered with its id and source reference) and `{{parties}}` (fictional default parties per template when the request names none).
- The citation format `[K:<chunk-id>]`, required after every statement that rests on a source, documented in `prompts/README.md` and stated in both templates.
- Drafts in Markdown, with one heading per required section.
- Missing details become bracketed placeholders such as `[lön]`, `[tillträdesdag]`; nothing is invented except the fictional parties.
- A fixed disclaimer line in Swedish at the end of every draft (the draft is source material, not legal advice).
- A backend module that loads the template for a template id and renders it into a system prompt and a user prompt for the `Generator` role.

## Non-goals

- Calling an LLM, wiring the templates into `createLlmGenerator`, parsing citations, context-size limits and the `query` CLI: E6-2.
- Producing and saving example drafts with a real LLM: moved to E6-2 (see Decisions).
- Checking citations or free-text references in a draft: E6-3.
- Templates for other contract types, user-editable templates or templates stored in the database.
- Choosing the template from free text; the caller passes the template id.

## Acceptance Criteria

1. **Both templates define a complete draft with fictional parties.**
   - Each template file names every required section listed in Goals for its contract type, asks for one Markdown heading per section, and contains default fictional parties used when the request names none.
   - A unit test loads both templates and asserts that every required section name appears in the rendered prompt, and that rendering without parties inserts the template's default fictional parties.
   - The manual check with a real LLM and the saved example outputs from the issue's criterion are done in E6-2 (see Decisions).
2. **The citation format is documented and used in both templates.**
   - `prompts/README.md` documents `[K:<chunk-id>]`: what the id is, where the citation goes, that only ids from the supplied chunks may be cited, and how it differs from placeholders such as `[lön]`.
   - A unit test asserts that both rendered templates contain the citation instruction, and that every supplied chunk appears in the `{{chunks}}` slot with its id written as `[K:<id>]` and its source reference.
3. **Slots are filled and errors are clear.**
   - Rendering replaces every `{{instruction}}`, `{{chunks}}` and `{{parties}}`; a unit test asserts that no `{{` remains in the output.
   - Loading an unknown template id throws an error naming the id and listing the available ones; a template file missing a slot or its system/user part fails with an error naming the file. Unit tests cover both.
   - Both templates contain the disclaimer line and the placeholder instruction (asserted in a unit test).
4. **The checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 with no network access.

## Tasks

- [x] Write `prompts/employment.md` and `prompts/nda.md` in Swedish: role/system text, required sections, citation rule, placeholder rule, Markdown output, disclaimer line, default fictional parties, and the user part with the three slots.
- [x] Write `prompts/README.md` (in English): file structure of a template, the slots, the citation format, the placeholder convention, how to add a template.
- [x] Backend module (in `backend/src/generation/`) that loads and validates the prompt template for a template id (`TEMPLATES`), and renders it to `{ system, prompt }` from instruction, chunks and optional parties.
- [x] Make sure `prompts/` is formatted consistently with Prettier (it is formatted, not excluded; Prettier leaves the prompt text unchanged).
- [x] Unit tests for every acceptance criterion.

## Decisions

- **Markdown output** (owner): one heading per contract section; reads well in the terminal and renders in the UI (E7).
- **Placeholders for missing details** (owner): only the parties are fictional (from `{{parties}}`); salary, dates and other details the instruction does not give become `[lön]`-style placeholders, so no invented fact looks real. Citations are told apart by their `K:` prefix.
- **Templates written in Swedish** (owner): the whole template, including the instructions to the model, is Swedish, to get natural Swedish legal language. This departs from the `CLAUDE.md` rule that committed content is English; it applies only to the template files. `prompts/README.md`, code and comments stay in English.
- **Example drafts in E6-2** (owner): the issue's manual check ("both templates produce a complete draft … outputs saved as examples") needs a working generator, so it is done with E6-2's `query` CLI and becomes an E6-2 acceptance criterion. This departs from the issue, which places it in E6-1.
- **Template ids `employment` and `nda`** (owner): the ids the repo already uses for template tag presets (E3-1, `TEMPLATES` in `tagging/vocabulary.ts`) and evaluation queries (E5-3), so one id selects both the tag presets and the prompt, and `query --template` in E6-2 takes the same ids. The template ids come from `TEMPLATES`, and a test asserts that every id has a prompt file. Departs from the issue's `anstallningsavtal.md` / `sekretessavtal.md`.
- **Templates in repo-root `prompts/`** (default): as the issue suggests, found through `REPO_ROOT` like other repo data.
- **One file per template with a system part and a user part** (default): the file is split by two fixed headings so the system text can go in the `system` field of the LLM call and the slots in the user content. The default fictional parties live in the same file, so each template is self-contained.
- **Plain `{{name}}` replacement, no template library** (default): three slots do not need a dependency.
- **Chunk rendering in `{{chunks}}`** (default): each chunk as `[K:<id>]`, its source reference and its text, in the order given (E6-2 orders them by score).
- **Disclaimer as a fixed line in the template** (default): E6-2 decides whether to also enforce it in code.
- **Four parts per file** (implementation): `## System`, `## Användare`, `## Standardparter` and `## Friskrivning`. The disclaimer has its own part and reaches the system prompt through a `{{disclaimer}}` slot, so E6-2 can read the exact line to enforce it. Loading fails on a missing part, a missing slot or an unknown slot.
- **Required sections are numbered in the system prompt** (implementation): the test checks each section name as a numbered line, which also fixes their order in the draft.
- **Chunk without a source reference** (implementation): rendered as `[K:<id>]` and its text only.
- **Stricter template validation** (code review): an unknown or repeated `##` part, an empty part, and anything in double braces that is not a known slot (e.g. `{{ lön }}`) fail loading, since each would silently cut or leak prompt text.
- **At least one chunk** (code review): rendering with no chunks throws; E6-2 stops before generation when nothing is approved, so an empty source list is a caller error.
- **Parties wording** (code review): the templates say to use the parties under "Parter" exactly as given, instead of calling them fictional, since a caller may pass real parties.
- **Shared citation format** (code review, reshaped in PR review): `citation()` writes the format and `findCitations(text)` reads it, both exported from the template module so E6-2 and E6-3 parse what the prompt asks for. `findCitations` returns one entry per id with the offsets of its bracket group, and accepts groups (`[K:12, K:40]`, `[K:12, 40]`) as E6-2 and E6-3 require; its regex is private, so no caller shares a global regex's `lastIndex` (**extended by E6-3**: a group must close on the same line, so a stray `[K:` cannot hide later text).
- **Templates read once** (code review): loaded templates are kept per file path.
- **Left to E6-2** (code review findings, not fixed here): the placeholder generator in `llm/roles.ts` still formats chunks as `[id] (source)`, and `GenerateInput` has no `parties`; E6-2 replaces that generator with the template and adds optional parties to its input, as its spec says (**done in E6-2**).
- **README** (implementation): a short "Prompt templates" section in the root README points to `prompts/README.md`.

## Open Questions

- None.
