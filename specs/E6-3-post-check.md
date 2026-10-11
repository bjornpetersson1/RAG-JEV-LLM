# E6-3 · Post-check

- **Issue:** [#21](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/21)
- **Labels:** `E6 Generation`
- **Phase:** 4. Judging and generation
- **Depends on:** E6-2 (#20)
- **Status:** Approved

## Summary

A post-check of every generated draft: it finds the `[K:<chunk-id>]` citations and the free-text legal references ("7 § LAS", "AD 2019 nr 35"), flags each one that does not match a chunk sent to the generator, with its position in the text, and computes the run's source accuracy (the share of references that are valid). The result is part of the E6-2 generation result, printed by the `query` CLI and ready for the UI (E7-2) to show.

## Goals

- Check `[K:<id>]` citations against the submitted chunk ids.
- Detect free-text references to statutes and cases and check them against the submitted chunks' source references:
  - statute provisions: `7 §`, `33 d §`, `2 kap. 9 §`, optionally with `st.` / `första stycket`, followed by a law abbreviation (`LAS`) or `lagen (1982:80)` / `(1982:80)`;
  - whole statutes: `SFS 1982:80`, `lagen (1982:80)`, or a known abbreviation alone;
  - cases: `AD 2019 nr 35`, `NJA 2015 s. 123`.
- A small table of abbreviations for the imported laws (e.g. `LAS` → `SFS 1982:80`, `MBL` → `SFS 1976:580`, `SemL` → `SFS 1977:480`, `ATL` → `SFS 1982:673`, `DL` → `SFS 2008:567`, `AvtL` → `SFS 1915:218`).
- Output per run: the list of flagged references (kind, the matched text, start and end offsets in the draft, reason) and source accuracy, plus the counts behind it.
- The `query` CLI prints the flagged references and the source accuracy.

## Non-goals

- Changing the draft text: references are only flagged, never marked or removed.
- Showing the flags in the UI: E7-2.
- Checking that a cited chunk actually supports the sentence it is attached to (semantic verification).
- Recognising every way of citing Swedish law: other courts (e.g. `HFD`, `MÖD`), EU law, preparatory works (`prop.`) and laws outside the imported set are not detected, and a statute abbreviation not in the table is not detected.
- Storing source accuracy across runs (measurement and aggregation: E7).

## Acceptance Criteria

1. **A deliberately wrong reference in a test is flagged.**
   - A draft citing `[K:<id>]` for an id that was not submitted gets a flag of kind `citation` with the exact offsets of the citation; citations of submitted ids are not flagged. Several ids in one bracket group are checked one by one.
   - Unit tests cover a valid citation, an unknown id, an id that was approved but cut by the context limit (E6-2), and offsets that point at the citation in the text.
2. **Source accuracy is computed and returned per run.**
   - Source accuracy = valid references / all references, counting every occurrence of a `[K:]` citation and of a detected free-text reference. With no references at all it is `null` (shown as "–"), not 100 %.
   - The E6-2 generation result carries the post-check (flags, counts, source accuracy), and the `query` CLI prints the source accuracy and each flag with its text and position. A flow test with a fake generator asserts it.
3. **Free-text references that don't match any submitted chunk are flagged.**
   - A free-text reference is valid when a submitted chunk's source reference has the same document (SFS number or case identifier) and, if the reference names a chapter and/or section, the same chapter and section. A reference to a whole statute or case is valid if any chunk of it was submitted.
   - Unit tests: "7 § LAS" valid when `SFS 1982:80 7 §` was submitted and flagged when only `SFS 1982:80 8 §` was; "2 kap. 9 § diskrimineringslagen"-style chapter references; "lagen (1982:80)"; "SFS 1977:480"; "AD 2019 nr 35" valid against `AD 2019 nr 35, Domskäl, del 1/2` and flagged otherwise; "NJA 2015 s. 123"; text inside a `[K:]` citation is not read as a free-text reference; an unknown abbreviation is not detected.
4. **The checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 with no network access.

## Tasks

- [ ] Citation check against the submitted ids, with offsets.
- [ ] Free-text reference detection (provisions, statutes, cases) and the abbreviation table.
- [ ] Matching of free-text references against the submitted chunks' source references.
- [ ] Source accuracy and counts.
- [ ] Add the post-check to the E6-2 generation result and the `query` CLI output.
- [ ] Unit and flow tests for every acceptance criterion.

## Decisions

- **Flag only** (owner): the draft is not changed; the flags carry positions so the UI (E7-2) can mark them.
- **Source accuracy over all references** (owner): every `[K:]` citation and every detected free-text reference counts, each occurrence separately; a draft with no references gets `null` rather than a perfect score.
- **Provisions and cases recognised** (owner): section references with a law abbreviation or SFS number, SFS numbers, and `AD`/`NJA` cases; abbreviations come from a table covering the imported laws.
- **Citations of approved-but-not-submitted chunks are invalid** (default): the issue measures against the chunks sent to the generator, not everything JEV approved.
- **Matching ignores paragraph (`st.`) and split suffixes** (default): a chunk's source reference may carry `st. 2`, headings or `del 1/2`; a free-text reference matches on document, chapter and section, so "7 § LAS" is valid against `SFS 1982:80 7 § st. 2`.
- **A section without a chapter matches any chapter** (default): "9 § DL" is valid against `SFS 2008:567 2 kap. 9 §`, since drafts often leave the chapter out.
- **Offsets in UTF-16 code units** (default): what JavaScript string indices use, so the UI can slice the text directly.
- **Code in `backend/src/generation/`** (default), next to the generator.
- **Builds on what E6-2 delivered** (spec update after E6-2 merged): `[K:]` citations come from E6-1's `findCitations`, whose offsets are those of the bracket group, so every id in a group `[K:12, K:40]` is flagged with the group's offsets. The post-check runs inside `generateDraft` against its submitted chunks and is part of `GenerationResult`; when no chunk fit the limits there is no text and no post-check. E6-2's interim `outsideCitations` list is replaced by the citation flags, and the CLI's "Citations outside the submitted chunks" line by the post-check output.

## Open Questions

- None.
