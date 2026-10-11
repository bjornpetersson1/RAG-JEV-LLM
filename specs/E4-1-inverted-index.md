# E4-1 · Inverted index

- **Issue:** [#11](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/11)
- **Labels:** `E4 Index and search`
- **Phase:** 3. Tags and index
- **Depends on:** E1-3 (#3), E3-2 (#9)
- **Status:** Approved

## Summary

An in-memory inverted index tag → chunk ids built on roaring bitmaps, with AND, OR and ranked OR search behind a `TagIndex` interface that E4-2 (bloom filter) implements too. The server builds it from `chunk_tags` at startup, and a synthetic data generator and `bench:index` show that a search over 100,000 chunks takes under 5 ms.

## Goals

- A `TagIndex` interface shared with E4-2: `build`, `searchAll` (AND), `searchAny` (OR) and `searchRanked` (OR ranked by the number of matching tags, with a minimum match count and a limit).
- A roaring-bitmap implementation of it using `roaring-wasm`.
- Loading the index from `chunk_tags` when the server starts, logging build time, chunk and tag counts, and memory.
- A seeded synthetic data generator (default 100,000 chunks, configurable tag count, tags per chunk and distribution).
- `npm run bench:index`, which reports the median search time per query mode and fails above 5 ms.

## Non-goals

- An HTTP search route or any query flow; E4-4 (query translator) and E5 use the index.
- The bloom filter variant (E4-2) and the full-text fallback (E4-3).
- Updating the index while the server runs; it is rebuilt at the next start after `index:tag`.
- Migrating or creating the database at server start (E1-3 decided only `db:migrate` touches the schema).
- Comparing against the reference RAG (E5-4); this issue only produces the numbers.
- Persisting the index to disk.

## Acceptance Criteria

1. **Unit tests for AND, OR, empty result, unknown tag and ranking pass.**
   - `searchAll(tags)` returns the ids of chunks that have every given tag; `searchAny(tags)` those that have at least one; both in ascending id order.
   - `searchRanked(tags, { minMatches, limit })` returns `{ chunkId, matches }` for chunks with at least `minMatches` of the tags (default 1), sorted by `matches` descending, then `chunkId` ascending, cut to `limit` (default 200).
   - An empty tag list returns an empty result in all three modes. An unknown tag matches nothing: `searchAll` with an unknown tag returns empty, `searchAny` and `searchRanked` ignore it. Repeated tags in a query count once.
   - `minMatches` and `limit` must be positive integers; anything else throws.
   - A shared test suite runs these cases against any `TagIndex` implementation, so E4-2 reuses it; it runs here against the roaring index.
   - `npm test` passes with no network access.
2. **A search over 100,000 synthetic chunks takes under 5 ms (median of repeated runs).**
   - `npm run bench:index` generates 100,000 chunks with the default seeded distribution, builds the index, and for each mode (`searchAll`, `searchAny`, `searchRanked` with the default limit) runs a fixed set of queries of 3 and 5 tags repeatedly after a warm-up, and prints the median and p95 per mode plus build time and memory.
   - It exits non-zero if any mode's median is 5 ms or more, and 0 otherwise. The result on the owner's machine is recorded in this spec when implemented.
   - The generator is deterministic for a given seed; a unit test checks that two runs with the same seed give the same data and that every chunk's tag count lies within the configured range.
3. **The index is built from the database at server startup.**
   - On start the server opens the database at `DATABASE_PATH` (read-only use, no migration), builds the roaring index from `chunk_tags` (tag slug → chunk ids), makes it available to the app, and logs build time, number of chunks, number of tags and memory before listening.
   - If the database file is missing, is not migrated, or has no tags, the server still starts with an empty index and logs a warning naming the command to run (`npm run db:migrate`, `npm run index:tag`).
   - A test builds the index from a temporary database with known `chunk_tags` rows and checks the search results; another checks that a missing or unmigrated database gives an empty index and the warning.

## Tasks

- [ ] Add `roaring-wasm` to the backend; verify it loads under Node 24 on the owner's machine (x86_64 macOS).
- [ ] `TagIndex` interface and result types in a new `backend/src/search/` module.
- [ ] Roaring implementation (`build(chunkTags)` from tag–chunk pairs, the three search modes).
- [ ] Shared `TagIndex` contract test suite, run against the roaring index.
- [ ] Loader from `chunk_tags` joined with `tags`, with the empty-index fallback and warning.
- [ ] Server startup: build the index before listening, pass it to `buildApp`, log the stats.
- [ ] Seeded synthetic generator (chunk count, tag count, tags per chunk range, Zipf-like skew).
- [ ] `bench:index` script (backend and root), with the 5 ms check.
- [ ] README: the index, its startup log and `bench:index`.
- [ ] Tests per acceptance criterion.

## Decisions

- **Default mode is ranked OR** (owner): with the 3–8 tags a query translates to, AND is often empty; ranking by the number of matching tags puts the best candidates first while keeping partial matches. `searchAll` and `searchAny` remain for E4-3/E5 and the measurements.
- **`roaring-wasm`** (owner): roaring bitmaps as the requirements state, without a native build or a prebuilt binary for Node 24 on x86_64. Its asynchronous initialisation is awaited once before the first index is built.
- **Ranked search returns the top K, default 200** (owner): sorting tens of thousands of partial matches is not needed downstream, where JEV judges a bounded set. The 5 ms criterion applies with the default limit.
- **Server starts with an empty index when there is nothing to load** (owner): `/health` and the dev loop keep working before data exists; the warning tells what to run. Consistent with E1-3's "no migration at server start".
- **Tags are keyed by slug** (default): queries come from the query translator (E4-4) as slugs from the E3-1 vocabulary, and slugs are stable across vocabulary syncs, unlike row ids.
- **`minMatches` default 1** (default): ranked OR without a floor; callers raise it when they want stricter matches.
- **Synthetic distribution** (default): 183 tags (the size of the E3-1 vocabulary), 3–8 tags per chunk as in E3-2, tag popularity Zipf-like so some tags are broad and most are narrow, seed fixed by default and overridable.
- **The 5 ms check is in `bench:index`, not in `npm test`** (default): timing in the test suite would be flaky on a loaded machine; the tests check correctness, the bench checks speed.
- **The frontend page title change rides along** (owner): the owner's uncommitted change of `<title>` in `frontend/index.html` to "LEGAL RAG LLM JEV POC" is committed with this issue; it is unrelated to the index.
- **Memory is measured as the heap and external/array-buffer delta** around the build (default), which covers the WASM memory.

## Open Questions

- None.
