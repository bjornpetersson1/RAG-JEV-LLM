# E4-3 · Full-text fallback

- **Issue:** [#13](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/13)
- **Labels:** `E4 Index and search`
- **Phase:** 3. Tags and index
- **Depends on:** E2-4 (#7), E4-1 (#11)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 391 tests (387 backend, 4 frontend) and build exit 0; migration 0005 and candidate search tried on a copy of the real database)

## Summary

An SQLite FTS5 index over the chunks, kept in sync by triggers, and a `CandidateSearch` service that takes tag hits from the E4-1 index and fills up with full-text hits when there are fewer than N. Each candidate records where it came from, and a full-text-only mode serves as a baseline for the evaluation (E5-3).

## Goals

- A migration adding an FTS5 table over chunk text, context and source reference, kept in sync with `chunks` by triggers and filled for existing chunks.
- Swedish handling: `unicode61` with diacritics kept, prefix terms for inflected forms, a short Swedish stop word list.
- An FTS query built from the instruction and the labels of the chosen tags.
- `CandidateSearch` with three modes: `tags+fts` (default: tag search, full-text fills up when there are fewer than N), `fts` (full-text only) and `tags` (tag only).
- `MIN_TAG_CANDIDATES` (N) and `MAX_CANDIDATES` in `.env`.

## Non-goals

- Translating the instruction to tags (E4-4); `CandidateSearch` receives the tags.
- An HTTP route or the full query flow (E5/E6).
- A stemmer dependency or a Swedish stemming algorithm; prefix terms stand in for it.
- Judging or re-ranking candidates (E5).
- The evaluation itself (E5-3); this issue only provides the mode.

## Acceptance Criteria

1. **N is configurable.**
   - `MIN_TAG_CANDIDATES` (default 10) and `MAX_CANDIDATES` (default 30) are read from `.env`, documented in `.env.example`, and validated as positive integers with `MIN_TAG_CANDIDATES` ≤ `MAX_CANDIDATES`; an invalid value fails with a clear message.
   - A test with N set to a different value shows the fallback switching on and off at that value.
2. **When the fallback is used it shows in the log (with how many candidates it added).**
   - Every `CandidateSearch` call logs one structured line with the mode, the number of tag candidates, whether the fallback ran, how many full-text candidates it added, and the FTS query used.
   - A test asserts the log line for a search that falls back and for one that does not.
3. **A "full-text only" mode exists for the evaluation.**
   - Mode `fts` returns up to `MAX_CANDIDATES` full-text candidates without using the tag index; mode `tags` returns only tag candidates. Both are selectable per call.
   - A test covers each mode.
4. **Tests cover: enough tag hits (no fallback), too few (fallback fills), dedup.**
   - Enough tag hits: with at least N tag candidates, no FTS query runs and every candidate has origin `tag`; at most `MAX_CANDIDATES` are returned, in the ranked order from E4-1.
   - Too few: with fewer than N, full-text candidates are appended after the tag candidates, in bm25 order, until `MAX_CANDIDATES`; each has origin `fts`.
   - Dedup: a chunk found by both appears once, with origin `tag`.
   - The FTS table follows `chunks`: tests insert, update and delete chunks and check that full-text search reflects each change, and that the migration indexes chunks that already exist.
   - Swedish: a query with an inflected form (e.g. "uppsägningen") finds a chunk containing another form ("uppsägning"), and "å", "ä", "ö" are not folded ("lön" does not match "lon").
   - An instruction with no usable words (only stop words or punctuation) and no tags gives no FTS query and no error.
   - Tests run on temporary databases without network access.

## Tasks

- [x] `backend/migrations/0005_chunks_fts.sql`: FTS5 external-content table over `chunks` (`text`, `context`, `source_ref`) with `unicode61 remove_diacritics 0`, insert/update/delete triggers, and a rebuild for existing rows.
- [x] FTS query builder: tokenise the instruction and tag labels, lower-case, drop stop words, deduplicate, turn each term into a quoted prefix term, join with OR.
- [x] Search config: `MIN_TAG_CANDIDATES`, `MAX_CANDIDATES`; `.env.example`.
- [x] `CandidateSearch` (in the E4-1 `search` module): the three modes, dedup, origin per candidate, the log line.
- [x] README: the fallback, the modes and the settings.
- [x] Tests per acceptance criterion.

## Decisions

- **FTS query from the instruction and the tag labels** (owner): the labels add the legal terms the tagger chose, so a short instruction still finds text; the instruction catches words no tag covers.
- **N = 10, max = 30** (owner): E5 judges every candidate with JEV, so 30 bounds its cost and response time; below 10 tag hits full-text fills in.
- **Prefix terms instead of stemming** (owner): no new dependency. Every term becomes a prefix query; a word of 6 or more letters is first cut by up to 3 letters, keeping at least 5 (`uppsägningen` → `uppsägnin*`, `uppsägning` → `uppsägn*`). Shorter words are used whole as prefixes (`lön*`).
- **Index text, context and source reference** (default, extends the issue's "text + source ref"): the context holds the law title and headings, which are often the words a user writes.
- **External-content FTS5 with triggers** (default): no duplicate copy of the text; the E2-4 writer already leaves unchanged chunks untouched, so re-chunking reindexes only what changed.
- **OR of terms, ranked by bm25** (default): AND across all instruction words would rarely match; bm25 puts chunks with more and rarer terms first.
- **Mode `tags` too** (default): the evaluation (E5-3) can compare tag-only, full-text-only and combined without extra work.
- **Mode is a call option, not an `.env` setting** (default): the evaluation switches modes per run; the query flow uses `tags+fts`.
- **Tag candidates come from E4-1's ranked search with `limit = MAX_CANDIDATES`** (default), so the tag hits keep their ranking and the fill-up only appends.
- **Stop words** (default): a short fixed list of common Swedish function words (e.g. "och", "att", "som", "en", "ett", "för", "med", "på", "av", "i", "är", "det", "den", "till", "om"), kept in code.

- **Code layout** (settled while implementing): `search/fts-query.ts` builds the query, `search/candidate-search.ts` has `createCandidateSearch({ db, tagIndex, config, logger })`, and `MIN_TAG_CANDIDATES` and `MAX_CANDIDATES` join `SearchConfig` in `search/config.ts`. Both are validated at server start, with `MIN_TAG_CANDIDATES` ≤ `MAX_CANDIDATES`. Nothing in the server calls the search yet (E5/E6 do).
- **The result** carries the candidates, the number of tag candidates, whether full-text search ran, how many it added and the query (`null` when none ran). Mode `fts` counts as the fallback running, with zero tag candidates. Tag labels for the query are read from `tags` by slug, with one statement prepared up front (`json_each`). The full-text search fetches `MAX_CANDIDATES` rows, which always fill the free places.
- **Clean code**: `words()` in `src/text.ts` is shared by the query builder and the fake judge. `MIGRATIONS_DIR` is exported, and `createTestDatabase` takes an optional migrations directory for the migration test. The search tests share `createIndexLogger`.
- **Code review fixes**:
  - Words shorter than 3 characters are left out, since `"ab"*` or `"7"*` would match far too much. Numbers must match exactly (`"1982"`, not a prefix).
  - `words()` composes the text (NFC) first, so a decomposed "ö" does not split a word.
  - `fallbackUsed` is true only when a full-text query actually ran. An instruction with no usable words logs `fallbackUsed: false`.
  - `buildFtsQuery` returns `null`, like the result's `ftsQuery`.
  - The FTS tests reset their cleanup.
- **Not changed after code review**:
  - An FTS5 `prefix=` index helps only for prefix terms of the listed lengths, while the stems here vary from 3 to over 10 characters. On the corpus of about 2,100 chunks, a full-text query takes milliseconds.
  - `loadSearchConfig` validates all search settings, also when only the bench reads it. An invalid `.env` value should fail wherever it is read.
  - When re-chunking swaps two chunks' references, the E2-4 writer parks one under a temporary `#<id>`, which reindexes that chunk twice. Swaps are rare, and changing the writer is outside this issue.
- **Left for E5 (clean-code finding)**: `CandidateSearch` takes a live database handle, while the tag index is a snapshot built at startup. After `index:tag` or re-chunking without a restart, the two halves can disagree. E5, which wires the search into the query flow, should build both from one handle the server owns.
- **Skipped clean-code suggestion**: one wording for the min ≤ max checks. `search/config.ts` follows its own `BLOOM_HASHES` message and differs from `ingest/chunk-config.ts`.
- **The update trigger reindexes only when `text`, `context` or `source_ref` actually changes** (settled while implementing; the `WHEN` guard was added in clean code). Tagging state and ordinal updates do not reindex, and neither does the E2-4 writer rewriting a chunk with the same content. A test checks that the index is not written then. The migration's `rebuild` indexes existing chunks; a test migrates a database with chunks from version 4 to 5 and finds them.
- **The cut keeps at least 5 letters** as specified, so `semester` gives `semes*` and `sekretess` gives `sekret*`.
- **Known limitation: compounds.** A Swedish compound in the instruction does not match its first part on its own: `sekretessavtal` gives `sekretessav*`, which does not match `sekretess`. Tag labels often contain the base word, which softens this. A compound splitter is out of scope (no stemmer, per the owner's choice).
- **Real data** (settled while implementing): on a copy of the local database migrated to version 5, "Anställningsavtal med konkurrensklausul och uppsägningstid" with the tag `konkurrensklausul` gave 30 tag candidates and no fallback. "Sekretessavtal om företagshemligheter" with no tags fell back and filled 30 full-text candidates, led by AD rulings on confidentiality and SFS 2018:558 (lag om företagshemligheter).

## Open Questions

- None.
