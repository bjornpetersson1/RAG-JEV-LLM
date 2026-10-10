# E2-3 · Ruling import

- **Issue:** [#6](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/6)
- **Labels:** `E2 Data ingestion`
- **Phase:** 2. Data
- **Depends on:** E1-3 (#3), E2-1 (#4); builds on E2-2 (#5) for the `structure` column
- **Status:** Approved

## Summary

Parse the raw case-law API records fetched by E2-1 into `documents` rows with court, reference, case numbers, date, title and source URL, plus a JSON structure tree of the ruling's sections and sub-sections that the chunker (E2-4) uses directly. Only the deciding court's own part is imported. Run with `npm run data:import:rulings`; re-running updates instead of duplicating.

## Goals

- A parser from a case-law API record (JSON with HTML in `innehall`) to the document fields and a section tree.
- An importer that reads the ruling entries of `data/raw/manifest.json` and upserts one `documents` row per ruling, keyed on the identifier.
- Rulings whose sections cannot be detected are still imported, as one section, and flagged in the log.
- `npm run data:import:rulings` from the repo root.

## Non-goals

- PDF handling: E2-1 only selects rulings with HTML full text.
- Lower-court text: the district court judgment AD attaches as BILAGA, and the district and appeal court judgments printed before HD's part in an NJA report, are not imported (they stay in the raw file).
- Chunking and source-reference strings (E2-4).
- Resolving references to statutes or other cases inside the text (the API's `lagrumLista` etc. are not used).
- A new migration: the `structure` column comes from E2-2.

## Acceptance Criteria

1. **Each selected ruling has court, case number and date in the database.**
   - After `npm run data:fetch` and `npm run data:import:rulings`, each of the 50 rulings in the E2-1 selection has one `documents` row with `type = 'ruling'`, `court` (`AD` or `HD`), `identifier` = the reference number (`AD 2024 nr 13`, `NJA 2015 s. 741`), `date` = decision date (`avgorandedatum`, ISO `YYYY-MM-DD`), `title`, `source_url` and `fetched_at` from the manifest, `raw_text` and `structure` filled; `consolidated_through` is `NULL`.
   - The case numbers (e.g. `B 116-22`, `T 980-14`), every reference number and the API's summary are stored in `structure`.
   - The command prints a summary: inserted, updated, failed, flagged, and per ruling its number of sections.
2. **Re-running the import creates no duplicates.**
   - A second run leaves the number of `documents` rows unchanged, keeps each ruling's `id`, and reports the rulings as updated.
   - A unit test imports the same fixture twice into a temporary database and asserts one row with the same `id`.
3. **Unit tests with fixture rulings verify extracted fields and detected sections.**
   - Fixtures: trimmed real API records for one recent AD ruling with a BILAGA (from AD 2024 nr 13), one older AD ruling with upper-case headings (from AD 1994 nr 79) and one NJA report with three instances (from NJA 2015 s. 741), committed under the backend test fixtures.
   - Tests assert court, identifier, case numbers, date, title, and the tree: section headings in order (e.g. Bakgrund, Yrkanden …, Grunder …, Domskäl, Domslut), sub-sections under Domskäl (e.g. "Tystnadsplikt" in AD 1994 nr 79), paragraph text, that the AD BILAGA is not included, and that the NJA tree starts at HD's part and excludes the district and appeal courts.
4. **Rulings where sections cannot be detected are flagged in the log.**
   - A ruling with no recognised Domskäl or Domslut heading is imported with one section headed `Domen` holding all its paragraphs, a warning naming the identifier is logged, and it is counted as flagged in the summary; the exit code is not affected.
   - A record that cannot be imported at all (missing raw file, invalid JSON, empty `innehall`, no reference number or no decision date) is logged with its identifier and reason, the run continues, and the command exits non-zero at the end and names the failures.
   - Unit tests cover one flagged ruling and one failed record next to a valid one.
   - A missing `data/raw/manifest.json` stops the command at once with a message saying to run `npm run data:fetch` first.

## Tasks

- [ ] Ruling record parser: fields, HTML paragraphs to text (entities decoded, tags stripped), cut to the deciding court's part, heading detection, section tree.
- [ ] Ruling variant of the structure type shared with E2-2.
- [ ] Ruling importer: read manifest ruling entries, parse, upsert by identifier in one transaction per ruling, collect failures and flags.
- [ ] CLI command and scripts `data:import:rulings` (backend and root).
- [ ] Fixtures and unit tests for every criterion; tests run without network.
- [ ] README: the command, in the data section.

## Decisions

- **Identifier is the reference number** (owner): `AD 2024 nr 13`, `NJA 2015 s. 741`; unique across courts and what lawyers cite. When a record has several (`NJA 2015 s. 741`, `NJA 2015:69`), the first form (`s.` for NJA) is used. Case numbers are kept in `structure`. Departs from the example `HD T 1234-20` in the E1-3 schema comment; the README states the rule.
- **Only the deciding court's part** (owner, on condition that citations stay correct): every chunk then comes from AD's or HD's own text, so a reference like `NJA 2015 s. 741, Domskäl` always points to the court that is cited. For AD the text is cut at a paragraph that is exactly `BILAGA`; for NJA it starts at the paragraph `Högsta domstolen` that opens HD's part. If the HD marker is missing the whole text is used and the ruling is flagged.
- **Main sections with sub-sections** (owner): tree `{ kind: 'ruling', court, references, caseNumbers, summary, sections: [{ heading, paragraphs, subsections: [{ heading, paragraphs }] }] }`. Main sections are recognised from a fixed list of headings, case-insensitive and by prefix: Bakgrund, Yrkanden, Parternas talan, Grunder, Utveckling av talan, Utredning(en), Domskäl, Domslut, Rättegångskostnader, Skiljaktig mening, Tillägg, Tvisten, plus HD-specific ones found while implementing (e.g. "HD:s bedömning" is a sub-section, not a main one). Other short paragraphs (under 80 characters, no final full stop, not a numbered list item) become sub-section headings under the current main section. Paragraphs before the first main heading (party names, "Nr 13", "mot") form a section headed `Inledning`.
- **Undetected sections → one section and a flag** (owner): the ruling stays searchable; a flag rather than a failure.
- **Court as short code** (default): `AD` and `HD`, mapped from the API's `ADO` and `HDO`.
- **Title** (default): the API's `benamning` when present (e.g. "Partneravtalet"), otherwise the first sentence of `sammanfattning` cut to 200 characters, otherwise the identifier.
- **`raw_text`** (default): the paragraphs of the imported part joined by blank lines, the same text the tree holds.
- **Clerk and footer lines** ("Rättssekreterare: …", "Sekreterare: …", "Dom 1994-06-08, målnummer …", "HD:s dom meddelad: …") are dropped (default).
- **Upsert keeps the row's `id`, one transaction per ruling, non-zero exit on failures** (default), as in E2-2.
- **No new dependency** (default): the API's HTML is a flat list of `<p>` (and occasionally `<h1>`/`<h2>`) elements, so a small extractor is enough.

## Open Questions

- None.
