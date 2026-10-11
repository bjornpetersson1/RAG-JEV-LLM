# E4-2 · Bloom filter variant

- **Issue:** [#12](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/12)
- **Labels:** `E4 Index and search`
- **Phase:** 5. UI and measurement
- **Depends on:** E4-1 (#11)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 368 tests (364 backend, 4 frontend) and build exit 0; `bench:index` exits 0 and prints all three indexes and the false positive rates; the built server builds the bloom index from the real database with `TAG_INDEX=bloom`)

## Summary

A second `TagIndex` implementation built on a bit-sliced bloom filter signature per chunk, with optional verification against the exact tags, selected with `TAG_INDEX` in `.env`. `bench:index` compares it with the roaring index on 100,000 synthetic chunks and reports the false positive rate.

## Goals

- A bit-sliced bloom filter implementation of the E4-1 `TagIndex` interface (`build`, `searchAll`, `searchAny`, `searchRanked`).
- Configurable signature size (`BLOOM_BITS`) and hash count (`BLOOM_HASHES`), and verification on or off (`BLOOM_VERIFY`).
- Theoretical and measured false positive rate.
- `TAG_INDEX=roaring|bloom` selects the implementation the server builds at startup; default `roaring`.
- `bench:index` runs both implementations (bloom with and without verification) and prints them side by side.

## Non-goals

- Per-chunk filters scanned linearly; the bit-sliced layout is chosen instead.
- Making bloom the default, or deciding whether bloom is a demo requirement (open point in the requirements).
- Counting bloom filters, deletions or updating the index while the server runs.
- Comparing against the reference RAG's vector search (E5-4).
- Any change to the search interface or its results defined by E4-1.

## Acceptance Criteria

1. **The same test suite as E4-1 passes (with verification on).**
   - The shared `TagIndex` contract suite from E4-1 runs against the bloom index with verification on and passes unchanged.
   - With verification off, a test checks that every true match is still returned (no false negatives) in all three modes on a synthetic data set.
   - Invalid settings (`BLOOM_BITS` or `BLOOM_HASHES` not a positive integer, `BLOOM_HASHES` greater than `BLOOM_BITS`, `TAG_INDEX` not `roaring` or `bloom`, `BLOOM_VERIFY` not `true`/`false`) fail with a clear message, at server start and in tests.
   - A test checks that the server's index loader builds the implementation `TAG_INDEX` names.
   - `npm test` passes with no network access.
2. **The false positive rate is reported.**
   - The bloom index reports its theoretical false positive rate per tag test, from the bits, hash count and mean tags per chunk.
   - `bench:index` measures the false positive rate on the synthetic data: for each mode, the share of chunks returned by the unverified bloom search that the exact (roaring) search does not return, and prints it next to the theoretical rate.
   - The server's startup log for the bloom index includes the theoretical rate and the settings.
3. **Benchmark output shows search time for both implementations on 100,000 synthetic chunks.**
   - `npm run bench:index` prints, per implementation (`roaring`, `bloom` verified, `bloom` unverified) and per mode, the median and p95 search time over the same queries, plus build time and memory.
   - The 5 ms check from E4-1 still applies to the roaring index only; bloom times are reported, not gated.
   - The result on the owner's machine is recorded in this spec when implemented.

## Tasks

- [x] Bloom settings in the search config: `TAG_INDEX`, `BLOOM_BITS`, `BLOOM_HASHES`, `BLOOM_VERIFY`, validated like the other env settings; documented in `.env.example`.
- [x] Bit-sliced bloom index: one bitset column per signature bit across all chunks; a tag's candidates are the AND of its hash positions' columns; AND/OR/ranked built on that; exact tags per chunk kept for verification.
- [x] Theoretical false positive rate on the index.
- [x] Run the E4-1 contract suite against the bloom index with verification on; no-false-negative test with verification off.
- [x] Server startup builds the implementation `TAG_INDEX` selects.
- [x] Extend `bench:index` with both implementations and the measured false positive rate.
- [x] README: the two implementations, the settings and the bench output.

## Decisions

- **Bit-sliced signatures** (owner): a search reads `BLOOM_HASHES` columns per tag instead of scanning 100,000 filters, which makes it a fair comparison with roaring.
- **Verification configurable, on by default** (owner): verified bloom gives the same answers as roaring, so the shared suite applies; the bench also measures the raw results to show the cost and the false positive rate.
- **`TAG_INDEX=roaring|bloom`, default `roaring`** (owner): the requirements make the inverted index the default; bloom is the measured alternative.
- **Defaults `BLOOM_BITS=128`, `BLOOM_HASHES=6`** (default): with 3–8 tags per chunk (mean about 5.5) the theoretical false positive rate per tag test is about 0.1 %, and the 128 columns over 100,000 chunks take about 1.6 MB.
- **Columns are plain `Uint32Array` bitsets, no new dependency** (default): the bit-sliced layout needs only fixed-size bitsets.
- **Hash positions from SHA-256** (settled while implementing, replaces the planned double hashing): each of a tag's `BLOOM_HASHES` positions is its own 32-bit word of SHA-256 over the slug, computed once per tag at build time. Double hashing with FNV-1a gave similar slugs overlapping bit patterns. On the synthetic data it measured 0.43 % false positives per tag test, against 0.025 % with SHA-256 words and a theoretical 0.014 %.
- **Ranked search counts a tag as matching when all its positions are set** (default); with verification the counts are exact, without it a false positive can raise a chunk's count, which the bench measures.

- **Builds on E4-1's `BaseTagIndex`** (settled while implementing): the bloom index only implements the searches with distinct known tags. "Known" means the exact slugs seen at build time, so an unknown tag matches nothing even without verification. `TagIndex` gained a `description` (the implementation and its settings), which the startup log and the bench print. The bloom index adds `falsePositiveRate`.
- **Exact tags as compact lists** (settled while implementing): a flat `Uint16Array` of tag numbers with start offsets per chunk, checked by a linear scan of at most 8 entries. A `Set` per chunk took 22 MB and made verified OR about 10 ms; the lists take about 1 MB.
- **`search/config.ts`** reads `TAG_INDEX`, `BLOOM_BITS`, `BLOOM_HASHES` and `BLOOM_VERIFY` (`true`/`false`) and validates them at server start. The defaults are in `DEFAULT_SEARCH_CONFIG`. `tagIndexBuilder(config)` gives the loader the selected builder. `readBoolean` and `readOneOf` are new shared readers in `env.ts` (clean code).
- **Searches reuse scratch arrays** (clean code): one candidate bitset, built in a single fused pass per word. The query's tags are marked in a `Uint8Array`, so verifying a chunk scans its tag list once, and verified ranked search counts each candidate's exact matches in one pass. Verified `searchAny` went from 6.7 to 4.3 ms and `searchAll` from 0.85 to 0.14 ms.
- **`ordinalsOf`** in `tag-index.ts` gives both indexes the same dense chunk numbering (clean code).
- **The startup log nests the index description** as `index: { implementation, … }` (clean code), so a setting cannot overwrite a count. `measure` collects garbage until memory stops shrinking, at most four rounds.
- **Measured false positives** (`search/false-positives.ts`): the bench compares the unverified bloom index with roaring over the bench queries. The per-tag-test rate is the share of single-tag tests on chunks without the tag that still match, the figure the theory predicts. It also measures the share of wrong hits per mode, where a ranked hit is wrong when its match count is too high (ranked with no limit). The measured per-tag rate is above the theoretical one because chunks share popular tags, which the theory's independence assumption ignores.
- **The bench gates only roaring** (as specified): `Implementation.gated` returns, now that a non-gated implementation exists.
- **`measure` collects garbage until memory stops shrinking** (settled while implementing, changed in clean code): array buffers freed by one collection are only released by a later one, so a single collection could report 0 bytes for a build.
- **Measured on the owner's machine** (x86_64 macOS, Node 24.21, defaults 128 bits / 6 hashes, 100,000 synthetic chunks):

  | Index            | Build  | Memory kept | `searchAll` median / p95 | `searchAny` median / p95 | `searchRanked` median / p95 |
  | ---------------- | ------ | ----------- | ------------------------ | ------------------------ | --------------------------- |
  | roaring          | 137 ms | 2.9 MB      | 0.023 / 0.104 ms         | 1.14 / 2.19 ms           | 1.13 / 1.57 ms              |
  | bloom verified   | 361 ms | 3.7 MB      | 0.15 / 0.27 ms           | 4.69 / 6.54 ms           | 3.14 / 4.34 ms              |
  | bloom unverified | 350 ms | 2.2 MB      | 0.14 / 0.18 ms           | 2.14 / 3.99 ms           | 1.84 / 2.50 ms              |
  - False positives per tag test: theoretical 0.014 %, measured 0.051 %.
  - Wrong unverified hits: `searchAll` 0.235 %, `searchAny` 0.088 %, `searchRanked` 0.204 %.

- **Real data** (settled while implementing): with `TAG_INDEX=bloom` the server built the bloom index from the local database (2,116 chunks, 179 tags) in 18 ms, logging the settings and a theoretical rate of 0.005 %. `TAG_INDEX=blom` stopped the server with `Invalid TAG_INDEX "blom": expected roaring or bloom`.

- **Code review fixes**:
  - A chunk–tag pair given twice counts once. Roaring already behaved that way; the bloom index's tag lists did not. The case is now part of the shared contract suite. Removing duplicates with a `Set` of pair keys costs about 200 ms of build time at 550,000 pairs, which is not gated.
  - The bloom index rejects more than 65,536 tags, the limit of its 16-bit tag lists.
  - The per-tag false positive rate counts the returned chunks that lack the tag, rather than subtracting counts.
  - An unverified index keeps no exact tag lists and marks no query tags (2.2 MB instead of 3.6 MB).
  - The bench builds its three indexes through one helper, and the README says `BLOOM_VERIFY` does not apply to it.
- **`description` is typed explicitly** on the bloom index (PR review), so a change to its shape is a compile error.
- **Skipped clean-code suggestions**: binary search instead of the build-time `Map` from chunk id to ordinal (about 10–30 ms of build time, which is not measured against a limit); lifting the shared match counts into `BaseTagIndex` (two implementations so far).

## Open Questions

- None.
