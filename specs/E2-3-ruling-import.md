# E2-3 · Ruling import

- **Issue:** [#6](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/6)
- **Labels:** `E2 Data ingestion`
- **Phase:** 2. Data
- **Depends on:** E1-3 (#3), E2-1 (#4); builds on E2-2 (#5) for the `structure` column
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 175 tests (171 backend, 4 frontend) and build exit 0; a real `npm run data:import:rulings` imported all 50 rulings with court, reference, case numbers and date, none flagged or failed, and a second run updated all 50)

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

- [x] Ruling record parser: fields, HTML paragraphs to text (entities decoded, tags stripped), cut to the deciding court's part, heading detection, section tree.
- [x] Ruling variant of the structure type shared with E2-2.
- [x] Ruling importer: read manifest ruling entries, parse, upsert by identifier in one transaction per ruling, collect failures and flags.
- [x] CLI command and scripts `data:import:rulings` (backend and root).
- [x] Fixtures and unit tests for every criterion; tests run without network.
- [x] README: the command, in the data section.

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
- **HD's part starts at "HD (justitieråden …)"** (settled while implementing, for correct citations): the paragraph "Högsta domstolen" in an NJA report is followed by the parties' appeal and the reporting clerk's proposed judgment ("Föredraganden … föreslog … följande dom"), which has its own Domskäl and Domslut. Starting there would cite the clerk's proposal as HD's reasoning. All five NJA reports open HD's own decision with a paragraph starting "HD (", so the import starts there. This departs from the spec's "starts at the paragraph `Högsta domstolen`".
- **Main sections depend on where they appear** (settled while implementing): in the data, "Tvisten", "Rättegångskostnader", "Bakgrund" and "Utredningen" often appear inside Domskäl as sub-sections. So Bakgrund, Yrkanden, Parternas …, Grunder, Utveckling av talan, Utredning, Bevisning and Överklagad dom only open a main section before the court's reasons. After Domskäl, only Domslut-like headings (Domslut, Beslut, HD:s domslut, HD:s avgörande, Arbetsdomstolens ställningstagande/beslut/avgörande) and a dissent or addition do. "Skäl" counts as Domskäl, which AD uses for decisions. "Tvisten" and "Rättegångskostnader" are therefore not in the main list, which departs from the spec's list.
- **Inline headings in old NJA reports** (settled while implementing): reports from the 1980s and 1990s start sections inside a paragraph ("HD (…) beslöt följande dom: Domskäl. När …"). Such a paragraph is split into the intro, the heading and the text.
- **Dissents and additions** (settled while implementing): a paragraph like "Ledamoten X skiljaktiga mening", "Justitierådet X var skiljaktig …" or "JustR X … tillade följande" opens a main section "Skiljaktig mening" or "Tillägg". The line itself is kept as its first paragraph, so the judge's name stays in the text.
- **Opening lines** (settled while implementing): before the first main heading, AD's party block ("Nr 13", claimant, "mot", respondent) stays as paragraphs of Inledning. Short lines after it become sub-sections of Inledning, as in AD rulings whose statement of the parties' cases has no main heading.
- **Headings** (settled while implementing): a heading is at most 80 characters, starts with a capital letter, and does not end in `.`, `,`, `;` or `:`. It contains no colon followed by a space, so "Överklagade domen: Kalmar tingsrätts dom …" is text while "HD:s bedömning" is a heading. Headings in capitals are normalised ("DOMSKÄL" → "Domskäl").
- **Title** (settled while implementing): the first sentence of the summary ends at a full stop followed by a capital letter or the end of the text, but not after an abbreviation such as "s.k." or "bl.a.".
- **Flagged rulings are counted in the shared import result** (settled while implementing): `ImportResult.flagged` and a "Flagged …" log line per warning. The summary line reads "Inserted …, updated …, failed …, flagged …" for laws too, where flagged is always 0.
- **Fixtures are trimmed real records** (settled while implementing): the three records keep their fields. The full text is cut to the headings, the opening lines, the paragraph after each heading, the HD decision and dissent markers, and the BILAGA line, with long paragraphs shortened to 400 characters.
- **Checked against all 50 real rulings**: every ruling gets Domskäl/Skäl and Domslut-like sections, none is flagged, and none fails.
- **Each section records its role** (clean code): `RulingSection.role` is `opening`, `proceedings`, `reasons`, `ruling`, `dissent`, `addition` or `whole`. E2-4 and later retrieval can then tell the court's reasons from the parties' cases, and headings the importer made up (Inledning, Skiljaktig mening, Tillägg, Domen) from the court's own, without matching heading text again.
- **Shared importer test workspace** (clean code): `ingest/test-helpers.ts` (excluded from the build) creates the temporary raw directory and migrated database, and builds manifest entries with `fetch-raw`'s own file naming.
- **Code review fixes, checked against all 50 real rulings**:
  - A Bakgrund, Grunder … heading that repeats for each party (AD 2015 nr 35, AD 2018 nr 25 and others), or that follows a party's empty heading, stays a sub-section instead of opening a second main "Bakgrund".
  - Only all-caps headings with a word of five or more letters, or known section headings ("SKÄL"), are normalised, so "DO", "QQFS" and "III" keep their capitals.
  - A short line followed by a list item ("(1)", "a)", "- ", soft hyphen) or by text in lower case introduces a list and is not a heading (e.g. "Förbundet har yrkat att Arbetsdomstolen ska"). Known section headings such as "Domslut" before a numbered list are exempt.
  - The party block runs to the respondent after the last "mot" before the first main heading, which covers joined cases (AD 2023 nr 8).
  - A sub-heading that ends in a word like "och" or "hos" and has no text joins with the next line, for headings the source splits over two paragraphs (AD 2020 nr 18, AD 2002 nr 115).
  - A judge paragraph with "skiljaktig" is a dissent even if it also says "tillade", and old plural forms ("JustR:n A och B voro skiljaktiga") are recognised.
  - Paragraph tags are matched case-insensitively. A full text that yields no paragraphs fails instead of being imported as an empty "Domen".

## Open Questions

- None.
