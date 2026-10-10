# E2-4 · Chunking

- **Issue:** [#7](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/7)
- **Labels:** `E2 Data ingestion`
- **Phase:** 2. Data
- **Depends on:** E2-2 (#5), E2-3 (#6)
- **Status:** Approved

## Summary

Split every imported document into chunks from its structure tree (E2-2, E2-3): one per law section and transitional entry, one per ruling section or sub-section, with long ones split on paragraph boundaries. Every chunk stores an exact source reference and a context line. `npm run data:chunk` is idempotent and keeps chunk ids (and, for unchanged text, tags) stable across re-chunking by matching on the source reference.

## Goals

- Chunks for laws per chapter and section, and for rulings per section and sub-section, built from `documents.structure`.
- A source reference per chunk pointing to the exact place, including paragraph (stycke) or part when a section is split.
- A configurable maximum (`CHUNK_MAX_CHARS`, default 2000) and minimum (`CHUNK_MIN_CHARS`, default 200) chunk length.
- A `context` per chunk (document title and headings) that later roles put in front of the text.
- `npm run data:chunk` with a summary per document.

## Non-goals

- Tagging (E3-2), indexing (E4) or full-text tables (E4-3).
- Sending context to JEV or an LLM; this issue only stores it.
- An exact token count: `token_count` is an estimate (see Decisions).
- Merging adjacent law sections into one chunk.

## Acceptance Criteria

1. **Laws are split per chapter and section, rulings per section.**
   - Each law section gives at least one chunk; each transitional entry gives at least one chunk; no chunk holds text from two sections.
   - Each ruling section gives at least one chunk; a section with sub-sections gives one chunk for the text before the first sub-section (if any) and at least one per sub-section, except where short sub-sections are merged (criterion 3).
   - `ordinal` runs 0, 1, 2 … in document order per document.
2. **Every chunk has a source reference pointing to the exact place in the source.**
   - Laws without chapters: `SFS 1982:80 7 §`; with chapters: `SFS 2008:567 2 kap. 3 §`; transitional provisions: `SFS 2008:567 övergångsbestämmelser 2014:958`.
   - A split law section adds its paragraphs: `SFS 1982:80 7 § st. 2` or `… st. 2–3`; a single paragraph longer than the maximum adds parts: `… st. 2, del 1/2`.
   - Rulings: `AD 2019 nr 35, Domskäl`, with a sub-section `AD 1994 nr 79, Domskäl, Tystnadsplikt`; merged sub-sections `…, Domskäl, Lojalitetskravet – Tystnadsplikt`; a split adds `, del 2/3`.
   - `source_ref` is unique per document (enforced by the database); a heading that repeats within one ruling gets ` (2)`, ` (3)` …
   - Every chunk's `context` is the document title followed by the chapter and heading path, separated by `›` (e.g. `Lag (1982:80) om anställningsskydd › Uppsägning från arbetsgivarens sida › 7 §`).
3. **No chunk exceeds the configured max length.**
   - Length is measured in characters of `text` (context excluded). With the default and with `CHUNK_MAX_CHARS=300` in a test, every chunk's `text` is at most the maximum.
   - Splitting happens on paragraph boundaries first, then sentence boundaries, then whitespace; text is never lost or duplicated (a test asserts the concatenated parts equal the source text up to whitespace).
   - Pieces shorter than `CHUNK_MIN_CHARS` from a split are merged with a neighbour from the same section; short ruling sub-sections are merged with the next sub-section of the same main section; neither may exceed the maximum. Law sections and transitional entries are never merged with each other.
   - `CHUNK_MAX_CHARS` and `CHUNK_MIN_CHARS` are read from `.env`, documented in `.env.example`, and rejected with a clear message unless both are positive integers with min < max.
4. **A summary is printed: number of chunks per document, min/median/max length.**
   - `npm run data:chunk` prints one line per document (identifier, chunks, min/median/max characters) and a total line, and how many chunks were inserted, updated, unchanged and deleted.
5. **Unit tests cover a law with chapters, a law without chapters, and a ruling.**
   - Tests on temporary databases with structure trees built from the E2-2 and E2-3 fixtures assert chunk count, ordinals, source references, context and text for each of the three.
   - Re-chunking tests: re-running without changes keeps every chunk's `id` and its `chunk_tags`; changing one section's text keeps that chunk's `id`, updates its text and deletes its tags; removing a section deletes its chunk; adding a section inserts a chunk.
   - A document with no `structure` is logged with its identifier, skipped, and the command exits non-zero at the end; the other documents are chunked.

## Tasks

- [ ] `backend/migrations/0003_chunk_context.sql`: `chunks.context` (text, not null, default empty) and a unique index on (`document_id`, `source_ref`).
- [ ] Chunk config from `.env`: `CHUNK_MAX_CHARS`, `CHUNK_MIN_CHARS`, with validation; `.env.example` entries.
- [ ] Law chunker and ruling chunker from the structure tree: units, splitting, merging, source references, context.
- [ ] Re-chunk writer: per document in one transaction, match existing chunks by `source_ref`, insert / update (deleting tags when text changes) / delete, and renumber `ordinal`.
- [ ] CLI command and scripts `data:chunk` (backend and root), with `--document <identifier>` to chunk one document.
- [ ] Summary output.
- [ ] Unit tests for every criterion; tests run without network.
- [ ] README: the command and the two settings.

## Decisions

- **Max 2000 characters, min 200, both configurable** (owner): most law sections fit whole; ruling sections are split; short enough for JEV's unknown limit. Departs from the issue's "max length (tokens)" by measuring characters, which needs no tokenizer.
- **`token_count` is an estimate** (owner): `ceil(characters / 3.5)`, a typical ratio for Swedish text; E5-1 can measure the real ratio and change the constant.
- **Separate `context` column** (owner): `text` stays the exact source text for citations and full-text search; E3, E5 and E6 put `context` in front of it when calling a model.
- **Stable ids by `source_ref`** (owner): re-chunking matches chunks by (`document_id`, `source_ref`); same text keeps the row and its tags, changed text keeps the id but drops its tags (they no longer describe the text), and chunks whose reference is gone are deleted with their tags. This refines the issue's "replace and invalidate tags": only changed chunks lose their tags. E5-3 refers to chunks by document identifier and `source_ref`.
- **Merging only within one section** (owner): every `§` stays separately citable.
- **Source-reference language is Swedish** (default): `st.`, `del 1/2`, `kap.`, `övergångsbestämmelser`, since sources and drafts are Swedish (the issue's `part 2/3` becomes `del 2/3`). Paragraph numbers are used for laws only; ruling paragraphs are not numbered consistently, so ruling splits use parts.
- **Chunk text** (default): a law chunk's text starts with its section number (`7 § …`) as in the source; the chapter title and heading go in `context` only. A ruling chunk's text starts with its sub-section heading if it has one.
- **Repeated ruling headings** get ` (2)` etc. in order of appearance (default), so `source_ref` stays unique.
- **Documents are chunked one transaction each** (default); a failure leaves that document's previous chunks untouched.

## Open Questions

- None.
