# E4-1 · Inverted index

- **Issue:** [#11](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/11)
- **Labels:** `E4 Index and search`
- **Phase:** 3. Tags and index
- **Depends on:** E1-3 (#3), E3-2 (#9)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 342 tests (338 backend, 4 frontend) and build exit 0; `bench:index` exits 0 with medians 0.02 / 0.96 / 0.98 ms; the built server builds the index from the real database at startup)

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

- [x] Add `roaring-wasm` to the backend; verify it loads under Node 24 on the owner's machine (x86_64 macOS).
- [x] `TagIndex` interface and result types in a new `backend/src/search/` module.
- [x] Roaring implementation (`build(chunkTags)` from tag–chunk pairs, the three search modes).
- [x] Shared `TagIndex` contract test suite, run against the roaring index.
- [x] Loader from `chunk_tags` joined with `tags`, with the empty-index fallback and warning.
- [x] Server startup: build the index before listening, set it on the app, log the stats.
- [x] Seeded synthetic generator (chunk count, tag count, tags per chunk range, Zipf-like skew).
- [x] `bench:index` script (backend and root), with the 5 ms check.
- [x] README: the index, its startup log and `bench:index`.
- [x] Tests per acceptance criterion.

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

- **`build` is a function type, not a method** (settled while implementing): `BuildTagIndex = (chunkTags) => TagIndex` builds a finished index, so an index is never half-built. It is synchronous: `roaring-wasm` is initialised once with a top-level `await` when its module loads (code review), so a measured build never includes compiling the WASM module. `TagIndex` also exposes `chunkCount`, `tagCount` and `dispose()`, since roaring bitmaps live in WASM memory, which the garbage collector does not free.
- **`BaseTagIndex` holds the shared query rules** (clean code): it drops repeated tags, applies the unknown-tag and empty-query rules and validates ranked options, so an implementation (roaring here, bloom in E4-2) only searches with distinct known tags. `EMPTY_TAG_INDEX` is a shared empty index built on it, for a server with no tagged data.
- **The app holds the index as `app.tagIndex`** (settled while implementing): `buildApp` decorates it with the empty index and disposes it on close. `server.ts` replaces it with the loaded index before listening, so the build can log through Fastify's logger. A `tagIndex` option on `buildApp` (suggested in clean code) would need the index, and therefore a logger, before the app exists.
- **The loader checks migrations with the ledger** (clean code): `pendingMigrations(db)` in `db/migrations.ts` compares `schema_migrations` with the migration files without changing the database; it and `migrate` share `appliedVersions` (code review). The warning names the pending migrations. A database with no chunks gets its own warning naming the data commands, not just `index:tag` (code review). `openDatabase(path, { readOnly: true })` opens an existing file without creating it, its directory or the WAL setting.
- **Ranked search counts in a per-chunk array** (settled while implementing, changed in clean code and code review): chunks are numbered densely (ordinals in ascending id order), so the count array is as large as the corpus however high re-chunking pushes the ids. Each tag's ordinals are also kept as a `Uint32Array` in JavaScript memory, and ranked search adds them up in a `Uint16Array`, with no union bitmap. `rankByMatches` then scans that array twice: first it counts the chunks per match count, then it collects only the hits that make the limit and resets the counts. Results are copied out of a bitmap with an indexed loop, which is several times faster than `Array.from` on a `Uint32Array`.
- **`measure`** (timing and memory growth) lives in `search/measure.ts`, shared by the loader and the bench. With `--expose-gc` (the bench runs with it) it collects garbage before both samples, so the figure is what the index keeps (code review); the server's startup log runs without it and is an upper bound.
- **Bench** (settled while implementing): 20 queries of 3 tags and 20 of 5, drawn with the same Zipf popularity as the chunks' tags, one warm-up pass, then 25 rounds. The bench has an implementation list that E4-2 extends; the 5 ms limit applies to every listed implementation until E4-2 changes that.
- **Measured on the owner's machine** (x86_64 macOS, Node 24.21): 549,510 tags on 100,000 chunks; build 126 ms, 5.0 MB kept; median / p95 `searchAll` 0.021 / 0.092 ms, `searchAny` 0.98 / 1.86 ms, `searchRanked` 1.00 / 1.33 ms.
- **`syntheticQueries` rejects a query size above the tag count** (code review), which would otherwise loop forever.
- **Not changed after code review**:
  - Keeping each tag's ordinals next to its bitmap stores the ids twice (about 2.2 MB at 100,000 chunks, 40 kB on the real corpus). Copying them out of WASM per query instead doubles ranked search time. The memory figure therefore includes the copy, which the comparison with E4-2 should note.
  - A database path that exists but cannot be opened (a directory, a file that is not SQLite) still stops the server with "Cannot open database at <path>", as E1-3 decided for an invalid `DATABASE_PATH`. That is a misconfiguration, unlike the missing or unmigrated database the empty-index rule covers.
  - Any pending migration gives an empty index, even one unrelated to tags. The loader cannot know whether a pending migration changes `chunk_tags`. The warning names the migrations.
- **Skipped clean-code suggestions**:
  - Reading `chunk_tags` as sorted ids per tag instead of one row object per pair would save temporary memory at 100,000 chunks. The real corpus has about 9,700 pairs and builds in 8 ms.
  - Listening before the index is built would change the approved criterion "built at startup".
  - A logger type shared with `LlmLogger`: the loader needs `warn`, the LLM client `error`; both are structural subsets of Fastify's logger.
- **Real data** (settled while implementing): the server built the index from the local database in 8 ms: 2,116 chunks, 179 tags, 9,654 chunk–tag pairs. With `DATABASE_PATH` pointing to a missing file it started with the warning, `/health` answered, and no file was created.

## Open Questions

- None.
