# E3-3 · Control report

- **Issue:** [#10](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/10)
- **Labels:** `E3 Tagging`
- **Phase:** 3. Tags and index
- **Depends on:** E3-2 (#9)
- **Status:** Approved

## Summary

A control report on the tagging: chunks per tag (including tags no chunk got), chunks without tags, tags that are too broad, and a summary of the latest tagging run. It is printed after every `index:tag` run, available on its own as `npm run index:report`, and written to `reports/` each time. It is the owner's tool for spotting gaps and overly broad tags in the vocabulary (E3-1) and failed tagging (E3-2).

## Goals

- A report built from the database: `tags`, `chunk_tags`, the chunks' tagging state and the latest `tagging_runs` row (E3-2).
- Terminal output after `index:tag` and from `index:report`.
- A Markdown file `reports/tagging-<timestamp>.md` on every run.

## Non-goals

- Changing the vocabulary or re-tagging automatically from the report.
- Charts, a UI view or history comparison between runs.
- Quality judgement of individual tags beyond the broad-tag threshold.

## Acceptance Criteria

1. **The report is printed after every tagging run.**
   - `npm run index:tag` prints the report after its run summary, also when some chunks failed (the exit code still follows E3-2).
   - `npm run index:report` prints the same report without tagging and exits 0.
   - Both write the report to `reports/tagging-<timestamp>.md` (timestamp in UTC, filesystem-safe, e.g. `20261010T143000Z`) and print the file path. `reports/` is git-ignored.
2. **It lists chunks per tag (including zero) and chunks without tags.**
   - **Chunks per tag:** every tag in the `tags` table with slug, label, area and number of chunks, sorted by count descending then slug, including tags with 0 chunks. Tags with a share of tagged chunks above the broad threshold are marked as broad.
   - **Chunks without tags:** chunks that are tagged with the current model and vocabulary but got zero tags, with chunk id and source reference, in document and ordinal order. The terminal shows at most 50 and how many more there are; the file lists all.
   - **Summary:** total chunks; chunks tagged with the current model and vocabulary; chunks not yet tagged or out of date; chunks with at least one tag; chunks with zero tags; chunks with fewer than 3 tags; average tags per chunk with at least one tag; tags with 0 chunks; broad tags; and from the latest `tagging_runs` row its time, model, vocabulary version, discarded out-of-vocabulary slugs and estimated cost. Without any tagging run, the run part says so.
   - The broad threshold is `TAG_REPORT_BROAD_SHARE` (a number between 0 and 1, default 0.2) from `.env`, documented in `.env.example`, and rejected with a clear message when invalid.
3. **A test verifies report content on a small fixture.**
   - A unit test on a temporary database with a few documents, chunks, tags (including one with zero chunks and one above the broad threshold), chunk links, a chunk with zero tags, an untagged chunk and a `tagging_runs` row asserts the report data: counts per tag and their order, the broad mark, the zero-tag list and every summary number.
   - Tests also cover the terminal cut at 50 chunks with the remaining count, the file containing every chunk, the empty case (no tagging run yet), and that `index:tag` prints the report (with the fake Tagger).
   - Tests run without network access and leave no files behind.

## Tasks

- [ ] Report data from the database (one query function per section).
- [ ] Terminal and Markdown formatting.
- [ ] Report file writer in `reports/`; `.gitignore` entry.
- [ ] `TAG_REPORT_BROAD_SHARE` config with validation; `.env.example`.
- [ ] Print and write the report at the end of `index:tag`; CLI `index:report` with backend and root scripts.
- [ ] README: the report, its sections and the setting.
- [ ] Unit tests per acceptance criterion.

## Decisions

- **Broad tags above 20 % of the tagged chunks** (owner), configurable with `TAG_REPORT_BROAD_SHARE`; a tag on a fifth of all chunks barely narrows a search.
- **Always written to `reports/`** (owner), in addition to the terminal, so reports can be compared over time; the directory is git-ignored like `data/`.
- **At most 50 zero-tag chunks in the terminal, all in the file** (owner).
- **"Chunks without tags" means tagged chunks that got zero tags** (default): before the first run every chunk is untagged, which says nothing about the tagging; untagged and out-of-date chunks are counted in the summary instead.
- **Share of tagged chunks** (default): the broad share is computed over chunks with at least one tag, so untagged chunks do not hide broad tags.
- **Discarded slugs and cost come from the latest `tagging_runs` row** (default, from E3-2): the report does not re-run anything and works the same from `index:report`.
- **Report language** (default): headings and labels in English like the rest of the CLI output; tag labels and source references are shown as stored (Swedish).

## Open Questions

- None.
