# E2-2 · Law import

- **Issue:** [#5](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/5)
- **Labels:** `E2 Data ingestion`
- **Phase:** 2. Data
- **Depends on:** E1-3 (#3), E2-1 (#4)
- **Status:** Approved

## Summary

Parse the raw SFST law pages fetched by E2-1 into `documents` rows with title, SFS number, dates and source URL, plus a JSON structure tree (chapters → sections → paragraphs, and transitional provisions) that the chunker (E2-4) uses directly. Run with `npm run data:import:laws`; re-running updates instead of duplicating.

## Goals

- Migration `0002` adding `documents.structure` (JSON) and `documents.consolidated_through`.
- A parser from an SFST HTML page to title, SFS number, issue date, consolidated-through SFS number, normalized text and a structure tree.
- An importer that reads the law entries of `data/raw/manifest.json` and upserts one `documents` row per law, keyed on the identifier.
- `npm run data:import:laws` from the repo root.

## Non-goals

- Chunking or source references (E2-4); the tree only records chapter, section and paragraph numbers.
- Fetching (E2-1) and ruling import (E2-3).
- Historical versions of a law; only the consolidated text as fetched.
- Cross-references inside the text (e.g. "enligt 7 §") are kept as plain text, not resolved.
- Deleting laws that are no longer in the manifest.

## Acceptance Criteria

1. **Each selected law has title, SFS number and date in the database.**
   - After `npm run data:fetch` and `npm run data:import:laws`, each of the 11 laws in the E2-1 selection has one `documents` row with `type = 'law'`, `identifier = 'SFS <number>'` (e.g. `SFS 1982:80`), `title` as on the page (e.g. `Lag (1982:80) om anställningsskydd`), `date` = issue date ("Utfärdad", ISO `YYYY-MM-DD`), `consolidated_through` = the SFS number after "Ändring införd: t.o.m. SFS" (e.g. `2022:836`, or `NULL` when the page has none), `source_url` and `fetched_at` from the manifest, `raw_text` and `structure` filled.
   - `court` is `NULL` for laws.
   - The command prints a summary: inserted, updated, failed, and per law its number of chapters, sections and transitional entries.
2. **Re-running the import creates no duplicates.**
   - A second run leaves the number of `documents` rows unchanged, keeps each law's `id`, and reports the laws as updated.
   - A unit test imports the same fixture twice into a temporary database and asserts one row with the same `id` and the latest values.
3. **Unit tests with a small fixture law verify the extracted fields and preserved structure.**
   - Fixtures: a trimmed real SFST page for a law **without** chapters (from 2018:558) and one **with** chapters (from 2008:567), committed under the backend test fixtures.
   - Tests assert title, identifier, issue date, consolidated-through value, and the tree: chapter numbers and titles, section numbers including letter suffixes (e.g. `2 a`), headings, paragraph count and text per section, `amendedBy` moved out of the text, and the transitional provisions.
   - A test asserts that a line in running text starting with "N kap." or "N §" (e.g. "25 kap. skollagen, eller") is not taken as a new chapter or section.
4. **Import errors for a single document are logged and do not stop the run.**
   - A page that cannot be parsed (missing title, missing "Utfärdad" date or no sections found) or a raw file that is missing is logged with the law's identifier and the reason; the other laws are imported; the command exits non-zero at the end and names the failures.
   - A unit test runs the importer with one valid and one broken fixture and asserts that the valid law is stored and the broken one is reported.
   - A missing `data/raw/manifest.json` stops the command at once with a message saying to run `npm run data:fetch` first.

## Tasks

- [ ] `backend/migrations/0002_document_structure.sql`: nullable `structure` (JSON text) and `consolidated_through` on `documents`.
- [ ] SFST page parser: header fields, body text decoded from HTML entities, hard line breaks within a paragraph joined, then split into chapters, headings, sections, paragraphs and transitional provisions.
- [ ] Structure tree type, shared with E2-3 and E2-4 (see Decisions).
- [ ] Law importer: read manifest law entries, parse each raw file, upsert by identifier in one transaction per law, collect failures.
- [ ] CLI command and scripts `data:import:laws` (backend and root).
- [ ] Fixtures and unit tests for every criterion; tests run without network.
- [ ] README: the command, in the data section added by E2-1.

## Decisions

- **Structure as a JSON tree in a new `documents.structure` column** (owner): E2-4 reads the tree and does not have to parse text again; E2-3 stores ruling sections in the same column. `raw_text` holds the normalized law text (readable, used later for full-text search).
- **Law tree shape** (default): `{ kind: 'law', chapters: [{ number, title, sections: [{ number, heading, paragraphs, amendedBy }] }], transitional: [{ sfs, paragraphs }] }`. A law without chapters has one chapter with `number` and `title` `null`. `number` is a string (`'2 a'`). `heading` is the nearest heading above the section within its chapter (e.g. "Lagens ändamål"), or `null`.
- **Both dates** (owner): `date` is the issue date ("Utfärdad"); `consolidated_through` (new column) is the last amendment included, so it is visible which version a source reference points to.
- **Transitional provisions are imported** (owner) as their own part of the tree, one entry per amending act (e.g. `2008:567`) with its paragraphs. Departs from the recommended option; E2-4 chunks them like sections.
- **Amendment notes move to metadata** (owner): a trailing "Lag (2014:958)." on a section is removed from the paragraph text and stored as `amendedBy: '2014:958'`.
- **Paragraphs (stycken)** (default): blocks separated by blank lines; numbered (`1.`) and dash (`-`) list items belong to the paragraph that introduces them, so paragraph numbers match how Swedish law counts stycken. Line breaks inside a list are kept.
- **Repealed sections** ("N § Har upphävts genom lag (…)") are left out of the tree and counted in the summary (default).
- **Guard against false chapter and section starts** (default): a chapter starts only at a block beginning "N kap." followed by a heading and with a number after the previous chapter; a section only at a block beginning "N §" or "N x §" with a number after the previous section in the chapter. Anything else is text.
- **Identifier `SFS <number>`** (default), as in the schema comment from E1-3; the source is the manifest's `identifier`, so the import does not depend on the file name.
- **Upsert keeps the row's `id`** (default), so chunks and tags are not dropped by a re-import; `data:chunk` (E2-4) replaces a document's chunks when it runs.
- **One transaction per law** (default), so a failure leaves no half-written row.
- **Non-zero exit on any failure** (default), matching `data:fetch`.
- **No new dependency** (default): the SFST body is plain preformatted text inside one element, so a small extractor plus entity decoding is enough; no HTML parser library.

## Open Questions

- None.
