# E2-1 · Sources

- **Issue:** [#4](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/4)
- **Labels:** `E2 Data ingestion`
- **Phase:** 2. Data
- **Depends on:** E1-1 (#1)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 108 tests (104 backend, 4 frontend) and build exit 0; a real `npm run data:fetch` from an empty `data/raw/` fetched all 61 documents in 36.3 s with exit 0, and a re-run skipped all 61)

## Summary

Pick open Swedish sources for laws and court rulings, commit a fixed selection of 11 laws and 50 rulings around employment, contracts and confidentiality, and add `npm run data:fetch`, which downloads the raw documents into `data/raw/` together with a manifest. E2-2 and E2-3 parse these raw files into the database.

## Goals

- Laws from Regeringskansliet's legal database SFST (`https://rkrattsbaser.gov.se/sfst?bet=<SFS number>`), stored as the HTML page as fetched.
- Rulings from Domstolsverket's case-law API (`https://rattspraxis.etjanst.domstol.se/api/v1`), stored as the JSON record as fetched (its `innehall` field holds the full ruling as HTML).
- A committed selection file listing every chosen document.
- `npm run data:fetch` downloads the selection and writes a manifest with identifier, source URL, fetch date and file per document.
- A README section on sources, formats, license and how to fetch.

## Non-goals

- Parsing raw files into `documents` rows (E2-2, E2-3) or chunking (E2-4).
- Automatic updating, scheduled re-fetching or change detection beyond `--force`.
- Committing the raw data to the repo.
- Preparatory works, legal doctrine, ordinances, EU law and rulings from other courts than AD and HD.
- Fetching PDF attachments (`bilagaLista`); only rulings with HTML full text are selected.

## Acceptance Criteria

1. **About 10 laws and 50 rulings around employment, contracts and confidentiality are fetchable with one command.**
   - The committed selection file lists exactly the 11 laws and 50 rulings under _Selection_ below.
   - `npm run data:fetch` from the repo root writes one raw file per selected document under `data/raw/laws/` and `data/raw/rulings/` and exits 0 when every document was fetched.
   - A ruling whose fetched record has no HTML full text (empty `innehall`), or a law page without the expected law title, counts as a failed document.
   - A failed document is logged with its identifier and the reason, the run continues, and the command exits non-zero at the end with a count of failures.
   - Re-running skips documents whose raw file already exists and says so; `--force` fetches everything again.
   - Unit tests with a faked `fetch` (no network) cover: success for one law and one ruling, a failed document that does not stop the run, skip of existing files, `--force`, and the manifest content.
2. **Fetching takes at most a few minutes.**
   - A full fetch from an empty `data/raw/` finishes in under 5 minutes on a normal connection; the command prints the total time at the end. Verified by one manual run, reported in the PR.
3. **README documents each source, its format and its license.**
   - A "Data sources" section names both sources with their base URL, the raw format stored (HTML page for laws, JSON record with HTML content for rulings), the terms of use and the legal basis for reuse, and the command to fetch.
4. **A manifest file lists every selected document with identifier, source URL and fetch date.**
   - `data/raw/manifest.json` has one entry per successfully fetched document with `type` (`law` | `ruling`), `identifier`, `sourceUrl`, `fetchedAt` (ISO 8601), and `file` (path relative to `data/raw/`).
   - Entries for skipped documents are kept from the previous manifest, so the manifest always describes everything in `data/raw/`.

## Selection

**Laws (11)**, identifier = SFS number:

1982:80 (LAS), 1915:218 (avtalslagen), 2018:558 (företagshemligheter), 1977:480 (semesterlag), 2008:567 (diskrimineringslag), 1982:673 (arbetstidslag), 1976:580 (MBL), 1995:584 (föräldraledighetslag), 2018:218 (dataskyddslagen), 2002:293 (deltids- och visstidsanställda), 2012:854 (uthyrning av arbetstagare).

**Rulings (50)**, identifier = reference number (see E2-3):

- **AD (45):** AD 1994 nr 79, AD 1998 nr 80, AD 1999 nr 61, AD 2000 nr 3, AD 2001 nr 91, AD 2002 nr 15, AD 2002 nr 38, AD 2002 nr 115, AD 2003 nr 21, AD 2006 nr 49, AD 2009 nr 11, AD 2009 nr 63, AD 2010 nr 27, AD 2010 nr 42, AD 2010 nr 90, AD 2011 nr 11, AD 2012 nr 40, AD 2013 nr 24, AD 2015 nr 8, AD 2015 nr 35, AD 2015 nr 39, AD 2016 nr 21, AD 2017 nr 12, AD 2017 nr 44, AD 2017 nr 57, AD 2018 nr 25, AD 2018 nr 31, AD 2018 nr 48, AD 2018 nr 49, AD 2018 nr 61, AD 2019 nr 12, AD 2019 nr 22, AD 2019 nr 38, AD 2020 nr 11, AD 2020 nr 18, AD 2020 nr 26, AD 2020 nr 53, AD 2021 nr 1, AD 2021 nr 24, AD 2021 nr 67, AD 2022 nr 3, AD 2023 nr 8, AD 2023 nr 29, AD 2023 nr 39, AD 2024 nr 13.
- **HD (5):** NJA 1984 s. 665, NJA 1999 s. 469, NJA 2009 s. 672, NJA 2010 s. 629, NJA 2015 s. 741.

Topics: non-compete clauses, trade secrets, confidentiality and loyalty duty (most), plus dismissal, summary dismissal, probationary employment, discrimination and redundancy; HD on contract interpretation, § 36 of the Contracts Act and trade secrets.

## Tasks

- [x] Selection file committed in the repo (outside the git-ignored `data/`), with per document: type, identifier, title, and what is needed to fetch it (SFS number; the API's publication id for rulings).
- [x] Fetcher for SFST law pages and for single rulings from the case-law API, using Node's built-in `fetch`.
- [x] `data:fetch` CLI: sequential requests with a short delay, a descriptive `User-Agent`, a timeout per request, skip-existing and `--force`, per-document error logging, a final summary (fetched, skipped, failed, time) and non-zero exit on failures.
- [x] Manifest writer for `data/raw/manifest.json`.
- [x] Backend script `data:fetch` and a root script that calls it.
- [x] README "Data sources" section.
- [x] Unit tests per acceptance criterion 1 and 4, with a faked `fetch`.

## Decisions

- **Laws from SFST at rkrattsbaser.gov.se** (owner): consolidated text in HTML with "Utfärdad" and "Ändring införd: t.o.m. SFS …", reachable and verified for all 11 laws. Riksdagen's open data API (`data.riksdagen.se`) was the first candidate but reset every connection during the check.
- **Rulings from Domstolsverket's case-law API** (owner): JSON with full text as HTML, reference and case numbers, decision date, and free-text search; covers AD from 1993 and HD. No PDF handling needed, so E2-3 needs no PDF library.
- **Fetch on demand, not committed** (owner): `data/` is already git-ignored (E1-3); the selection file is committed, so the set of documents is fixed and reviewable while the raw files stay out of git.
- **Fixed, curated ruling list** (owner): chosen once by searching the API for _konkurrensklausul, företagshemlighet, tystnadsplikt, lojalitetsplikt, avskedande, saklig grund, anställningsavtal, provanställning, visstidsanställning, semesterlön, diskriminering_ (AD) and _konkurrensklausul, avtalstolkning, 36 § avtalslagen, företagshemlighet, jämkning_ (HD), keeping only rulings with at least 5,000 characters of HTML full text (AD's short default judgments are excluded) and ranking by how many core topics they match. A fixed list keeps the evaluation set (E5-3) stable.
- **11 laws** (owner): the nine named in the issue plus 2002:293 and 2012:854 instead of the vague "LAS-related ordinances". Departs from the issue's "about 10" by one.
- **Skip existing, `--force` to re-fetch** (owner); requests are sequential with a short delay so the sources are not hammered.
- **Raw format is the source's own** (default): the law's HTML page and the ruling's JSON record, unchanged, so parsing decisions stay in E2-2/E2-3 and can be redone without fetching again. Files are named by identifier, made filesystem-safe.
- **Manifest is generated, not committed** (default): it lives in `data/raw/` next to the files it describes, because the fetch date only exists after fetching.
- **License** (default): both sources publish public documents from Swedish authorities; laws and court decisions are not protected by copyright (1 kap. 9 § upphovsrättslagen 1960:729). The README states this and links each source's terms page as found during implementation.
- **No new dependency** (default): Node's built-in `fetch`; the CLI runs through `tsx` like `db:migrate`.
- **Only the fetch is tested against fakes** (default): tests must not use the network (CLAUDE.md); the real sources are checked by the manual run in criterion 2.
- **Selection file at `sources/selection.json`** (settled while implementing): per document `type`, `identifier`, `title` and `sfsNumber` (laws) or `publicationId` (rulings). A ruling's title is the API's `benamning` or the first sentence of its summary, cut to about 150 characters. Every API publication id was resolved from the reference number when the list was curated.
- **Raw file names** (settled while implementing): the identifier with every run of non-alphanumeric characters replaced by `-`, e.g. `laws/SFS-1982-80.html`, `rulings/NJA-2015-s-741.json`.
- **Fetch details** (settled while implementing): 500 ms between requests, a 30 s timeout per request, a `User-Agent` naming the project, and files and the manifest written through a temporary file, so an interrupted run never leaves a half-written file that a later run would skip. A failed forced re-fetch keeps the earlier file and its manifest entry. A raw file without a manifest entry (e.g. a deleted manifest) gets its file time as `fetchedAt`.
- **Law page check** (settled while implementing): the page, with HTML entities decoded, must contain the law's title from the selection. A small entity decoder (`ingest/html.ts`) is shared with E2-2.
- **Error formatting shared** (settled while implementing): `describeError` moved from the `db` CLI to `backend/src/errors.ts`, so both CLIs print errors the same way.
- **Measured fetch time** (criterion 2): a full fetch of all 61 documents took 35.5 s (4.5 MB) and, after the code-review changes, 36.3 s; a re-run that skipped everything took 0.0 s.
- **Terms** (criterion 3): Domstolsverket publishes case law as open data ("Öppna data är offentlig information som du kan ta del av och använda"); no separate license page was found for SFST, so the README relies on 1 kap. 9 § upphovsrättslagen for both sources.
- **Manifest robustness** (code review): the manifest starts from every raw file already on disk and is saved after each fetched document, so a run that is cut short still leaves a complete, correct manifest. A document whose source URL differs from its manifest entry (e.g. a corrected publication id) is fetched again even without `--force`. A raw file without a manifest entry keeps an entry dated by its file time, also when a forced re-fetch of it fails.
- **Stricter content checks** (code review): a ruling record must be a JSON object whose `id` is the requested publication id; law titles are compared with whitespace normalised (so `&nbsp;` in a title still matches); two identifiers that would map to the same raw file name stop the run before anything is fetched; a failed atomic write removes its temporary file.
- **`REPO_ROOT` in `backend/src/repo-root.ts`** (code review), shared by the `db` and `ingest` modules instead of living in the database config.

## Open Questions

- None.
