# E3-1 · Tag vocabulary

- **Issue:** [#8](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/8)
- **Labels:** `E3 Tagging`
- **Phase:** 3. Tags and index
- **Depends on:** E2-1 (#4)
- **Status:** Implemented — criteria 1–4 verified (npm ci, lint, format:check, typecheck, 257 tests (253 backend, 4 frontend) and build exit 0; `index:vocabulary` on a fresh database inserted 183 tags, a re-run left 183 unchanged, and an invalid file exited 1 and left the database unchanged); criterion 5 awaits the owner's approval of the list posted on #8

## Summary

A committed, fixed vocabulary of 100–300 Swedish tags for employment agreements and NDAs, grouped into 10 areas, with preset tag sets for the two templates. A loader validates the file and `npm run index:vocabulary` syncs it into the `tags` table. The tagger (E3-2) and the query translator (E4-4) choose from this list.

## Goals

- `sources/tags.json` with a `tags` list (per tag `slug`, `label`, `description`, `area`) and a `presets` object with `employment` and `nda` tag sets.
- A loader that reads and validates the file and computes a vocabulary version.
- `npm run index:vocabulary`, which syncs the file into the `tags` table.
- A summary of the list posted on issue #8 so the owner can review it.

## Non-goals

- Tagging chunks (E3-2) or deciding when chunks must be re-tagged (E3-2 uses the version from this issue).
- Query translation, JEV questions or area-based Choice questions (E4-4); this issue only provides the areas.
- An LLM script that proposes tags from the corpus.
- A UI for editing the vocabulary.
- English labels or translations.

## Acceptance Criteria

1. **The file contains 100–300 tags, each with slug, label, description and area.**
   - `sources/tags.json` has between 100 and 300 tags.
   - Every tag has a non-empty `slug` (lowercase ASCII letters, digits and hyphens, e.g. `jamkning-36-avtl`), `label` (Swedish), `description` (one Swedish sentence, so it reads well in "Handlar texten om <description>?") and `area`.
   - Every `area` is one of the 10 areas under _Areas_, and every area has 5–30 tags.
   - The loader accepts the committed file; a unit test loads it and asserts these properties.
2. **Validation fails on duplicates or missing fields.**
   - The loader rejects, with an error naming the offending tag and field: a duplicate slug, a duplicate label, a missing or empty field, a malformed slug, an unknown area, a total outside 100–300, an area outside 5–30, a preset slug that is not in the vocabulary, a duplicate slug within a preset, and a preset outside 10–25 tags.
   - Unit tests cover each of these cases on small in-test fixtures (with the count limits passed in, so fixtures stay small).
   - `npm run index:vocabulary` with an invalid file exits non-zero, prints the error and does not change the database.
3. **Template preset tag sets exist for both templates.**
   - `presets.employment` and `presets.nda` each list 10–25 slugs from the vocabulary.
   - The loader returns them, and a unit test asserts both exist and validate.
4. **The vocabulary is synced into the `tags` table.**
   - `npm run index:vocabulary` inserts new tags, updates changed `label`, `description` and `area` by slug, deletes tags no longer in the file (their `chunk_tags` rows go with them through the existing cascade), and prints counts of inserted, updated, deleted and unchanged tags plus the vocabulary version. It runs in one transaction.
   - Running it twice in a row changes nothing the second time (all unchanged).
   - The vocabulary version is a stable hash of the file's tags (not of whitespace or key order), exposed by the loader so E3-2 can store it in `chunk_tags.vocabulary_version`.
   - Unit tests on a temporary database cover insert, update, delete (including the cascade to `chunk_tags`), the idempotent re-run, and that the version changes only when tag content changes.
5. **Björn has reviewed and approved the list (comment on this issue).**
   - A comment on issue #8 lists the tags grouped by area (slug and label) and the two presets.
   - The owner's approval is given when reviewing the PR or the release PR; until then this criterion is reported as awaiting the owner, not as verified.

## Areas

`anstallning` (anställningsformer, anställningsavtal), `uppsagning` (uppsägning och avskedande), `konkurrens` (konkurrensklausuler och värvningsförbud), `sekretess` (sekretess, företagshemligheter, lojalitetsplikt), `lon` (lön och förmåner), `arbetstid` (arbetstid och ledighet), `semester`, `diskriminering`, `avtalsratt` (avtalsrätt och avtalstolkning), `skadestand` (skadestånd, vite och påföljder).

Each area in the file has a slug as above; the Swedish display name lives in code next to the area list.

## Tasks

- [x] Write `sources/tags.json`: 183 tags over the 10 areas, covering the topics of the 11 laws and 50 rulings in `sources/selection.json` (e.g. tillsvidareanställning, provanställning, uppsägningstid, saklig grund, avskedande, konkurrensklausul, värvningsförbud, sekretessklausul, företagshemlighet, lojalitetsplikt, vite, skadestånd, jämkning enligt 36 § AvtL), plus the two presets.
- [x] Loader and validator, with the count limits as parameters (defaults from the criteria).
- [x] Vocabulary version (hash).
- [x] Sync into `tags` in one transaction; CLI command `index:vocabulary` (backend script plus a root script).
- [x] README: the vocabulary file, how to change it, and the command.
- [x] Unit tests per acceptance criteria 1–4.
- [x] Post the review comment on issue #8.

## Decisions

- **`sources/tags.json`** (owner): `data/` is git-ignored, so the issue's `data/tags.yaml` would not be committed; JSON next to `sources/selection.json` needs no YAML dependency. Departs from the issue's path and format.
- **Written by hand in this issue** (owner): Claude writes the list from the topics of the selected laws and rulings; no LLM script and no API cost.
- **10 areas, 5–30 tags each** (owner): the 10 areas named in the issue; at most 30 per area keeps one JEV call per area manageable in E4-4.
- **The vocabulary may change after tagging** (owner): the version is a hash of the tag content; sync upserts by slug and deletes removed tags (cascading their chunk links); E3-2 re-tags chunks whose stored version differs.
- **Owner review in the PR, no extra stop** (owner): the epic runs on without pausing for the list. The list is posted on issue #8; criterion 5 stays open until the owner approves it when reviewing the PR or the release PR, and E3-2/E3-3 build on the list as written.
- **Presets in `tags.json`, 10–25 slugs each** (owner), validated against the vocabulary.
- **Command `index:vocabulary`** (owner), matching E3-2's `index:tag` and E3-3's `index:report`.
- **Labels unique too** (default): two tags with the same label would be indistinguishable to the tagger and in the UI.
- **Version hash** (default): SHA-256 of the tags sorted by slug, serialised canonically, first 12 hex characters; presets are not part of the version since they do not affect tagging.
- **Synced through the existing `tags` table** (default): no migration needed; the vocabulary version is not stored in the database by this issue, E3-2 stores it per tagged chunk.

- **Descriptions are phrases, not full sentences** (settled while implementing): each starts in lower case without a final full stop, so it slots straight into "Handlar texten om <description>?".
- **183 tags** (settled while implementing): 14–22 per area; `bisyssla` sits under `konkurrens` and `personuppgifter` under `sekretess`. Presets: 25 for `employment`, 23 for `nda`.
- **All problems in one error** (settled while implementing): the loader lists every invalid field, duplicate and count in one error, so a hand-edited file is fixed in one pass.
- **Code in `backend/src/tagging/`** (settled while implementing): `vocabulary.ts` (load, validate, version), `sync-vocabulary.ts` and `cli.ts`, which E3-2 and E3-3 extend with `index:tag` and `index:report`.
- **Review comment** posted on issue #8 (criterion 5) with every tag grouped by area and the two presets.

- **Shared database helpers** (clean code): `withDatabase` (open, migrate, run, close) moved from the ingest CLI to `db/with-database.ts`, and `createTestDatabase` to `db/test-helpers.ts`; the ingest and tagging CLIs and test workspaces use them. The sync compares tags through the loader's `TAG_FIELDS`, so a new field cannot be missed there.
- **Skipped clean-code suggestions**: deriving the committed-file test from `DEFAULT_LIMITS` (the literal numbers guard the spec's ranges against a loosened default) and a shared plain-object guard with `llm/` (outside this diff).

- **Code review fixes**: a tag with another problem (e.g. an unknown area) no longer also makes the presets that use it fail as "unknown slug", and per-area counts are skipped while an area is unknown, so the error points at the real problem; labels must be unique ignoring case, and labels and descriptions must not have surrounding whitespace; a file that is not valid JSON is reported with its path; an entry with an empty slug is named by index alone; `syncVocabulary` rejects a repeated slug instead of failing on the unique key; the committed file is loaded in `beforeAll`, so an invalid file fails the tests instead of test collection; the test workspace adds documents through `upsertDocument`.
- **One version for the whole vocabulary, not per tag** (code review finding, not changed): the owner chose a content hash of the whole vocabulary. Any edit therefore re-tags every chunk, which with the E3-2 tagger costs around 1 USD. A per-tag version would save that, but it would also leave old chunks tagged without newly added tags, since a new tag can apply to any chunk.

- **`DEFAULT_LIMITS` is module-private** (PR review): it is only the default parameter; callers pass their own `VocabularyLimits`.

## Open Questions

- None.
