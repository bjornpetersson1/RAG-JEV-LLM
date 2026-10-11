# E4-2 · Bloom filter variant

- **Issue:** [#12](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/12)
- **Labels:** `E4 Index and search`
- **Phase:** 5. UI and measurement
- **Depends on:** E4-1 (#11)
- **Status:** Approved

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

- [ ] Bloom settings in the search config: `TAG_INDEX`, `BLOOM_BITS`, `BLOOM_HASHES`, `BLOOM_VERIFY`, validated like the other env settings; documented in `.env.example`.
- [ ] Bit-sliced bloom index: one bitset column per signature bit across all chunks; a tag's candidates are the AND of its hash positions' columns; AND/OR/ranked built on that; exact tags per chunk kept for verification.
- [ ] Theoretical false positive rate on the index.
- [ ] Run the E4-1 contract suite against the bloom index with verification on; no-false-negative test with verification off.
- [ ] Server startup builds the implementation `TAG_INDEX` selects.
- [ ] Extend `bench:index` with both implementations and the measured false positive rate.
- [ ] README: the two implementations, the settings and the bench output.

## Decisions

- **Bit-sliced signatures** (owner): a search reads `BLOOM_HASHES` columns per tag instead of scanning 100,000 filters, which makes it a fair comparison with roaring.
- **Verification configurable, on by default** (owner): verified bloom gives the same answers as roaring, so the shared suite applies; the bench also measures the raw results to show the cost and the false positive rate.
- **`TAG_INDEX=roaring|bloom`, default `roaring`** (owner): the requirements make the inverted index the default; bloom is the measured alternative.
- **Defaults `BLOOM_BITS=128`, `BLOOM_HASHES=6`** (default): with 3–8 tags per chunk (mean about 5.5) the theoretical false positive rate per tag test is about 0.1 %, and the 128 columns over 100,000 chunks take about 1.6 MB.
- **Columns are plain `Uint32Array` bitsets, no new dependency** (default): the bit-sliced layout needs only fixed-size bitsets.
- **Hash positions by double hashing a 32-bit hash of the tag slug** (default), the standard way to get k positions from two hashes.
- **Ranked search counts a tag as matching when all its positions are set** (default); with verification the counts are exact, without it a false positive can raise a chunk's count, which the bench measures.

## Open Questions

- None.
