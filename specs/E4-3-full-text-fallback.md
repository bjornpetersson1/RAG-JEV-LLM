# E4-3 · Full-text fallback

- **Issue:** [#13](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/13)
- **Labels:** `E4 Index and search`
- **Phase:** 3. Tags and index
- **Depends on:** E2-4 (#7), E4-1 (#11)
- **Status:** Approved

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

- [ ] `backend/migrations/0005_chunks_fts.sql`: FTS5 external-content table over `chunks` (`text`, `context`, `source_ref`) with `unicode61 remove_diacritics 0`, insert/update/delete triggers, and a rebuild for existing rows.
- [ ] FTS query builder: tokenise the instruction and tag labels, lower-case, drop stop words, deduplicate, turn each term into a quoted prefix term, join with OR.
- [ ] Search config: `MIN_TAG_CANDIDATES`, `MAX_CANDIDATES`; `.env.example`.
- [ ] `CandidateSearch` (in the E4-1 `search` module): the three modes, dedup, origin per candidate, the log line.
- [ ] README: the fallback, the modes and the settings.
- [ ] Tests per acceptance criterion.

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

## Open Questions

- None.
