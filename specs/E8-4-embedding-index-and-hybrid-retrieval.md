# E8-4 · Embedding index and hybrid retrieval

- **Issue:** [#68](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/68)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-1 (#65), E8-2 (#66); uses E8-3 (#67) for the rerank step
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 729 tests (725 backend, 4 frontend) and build exit 0; `npm run index:embed` on the real corpus (2,116 chunks, then 0); `retrieve` and `query` with the real models; server startup checked with and without embeddings)

## Summary

Every chunk is embedded once with the configured `Embedder` and its vector cached in SQLite. A hybrid bge-m3 retriever (dense cosine plus a lexical half, fused by reciprocal rank fusion) becomes a candidate source chosen with `RETRIEVER=tags|bge|both`, and `npm run retrieve -- "<question>"` prints the reranked top-K with the time of each step. This is the embedding and vector search that E5-4 (#18) reuses.

## Goals

- `npm run index:embed`: embeds every chunk whose text, model or dtype changed since the last run, stores vectors as BLOBs.
- Vectors loaded into memory and searched by brute-force cosine similarity; the choice motivated in the README.
- Hybrid search: dense plus bge-m3 sparse weights if E8-2 found them available, otherwise SQLite FTS5 BM25, fused by RRF with configurable weights.
- `RETRIEVER=tags|bge|both` and `RETRIEVE_CANDIDATES` in `.env`; the query flow works with each value.
- `npm run retrieve -- "<question>" [--top-k <n>]`.
- Tests with a fake embedder, no network access.

## Non-goals

- A vector database or native extension (`sqlite-vec`).
- Re-chunking: E2-4's chunks, `source_ref` and `context` are reused unchanged.
- Changing tag search or its FTS5 fallback for `RETRIEVER=tags`.
- The reference RAG and `bench:compare` (E5-4, #18).
- `eval:run --retriever` and recall comparisons (E8-5).
- Choosing a new default `RETRIEVER` (stays `tags`, see Decisions).
- Embedding at query time anything other than the instruction.

## Acceptance Criteria

1. **`npm run index:embed` run twice in a row embeds nothing the second time.**
   - The second run prints that 0 chunks were embedded and all were up to date; a test with a fake embedder counts the embed calls (all chunks, then none).
   - A chunk whose text changes, or a change of `EMBEDDER_DTYPE`, makes only the affected chunks (resp. all chunks) re-embed; covered by the same test.
   - Starting the server or `retrieve` never embeds chunks; if vectors are missing or stale for `RETRIEVER=bge|both`, it fails with a message to run `npm run index:embed`.
2. **`npm run retrieve -- "konkurrensklausul efter anställningens slut"` prints the top-K chunks with source and rerank score.**
   - Each line shows the rank, `source_ref`, rerank score and retrieval rank; a footer shows the time for embedding the query, retrieval, rerank and total.
   - Run with the real models and `RERANKER=bge` on the demo machine; the output is quoted in the PR. This also verifies E8-3's criterion 1 for `retrieve`.
   - `--top-k <n>` overrides `RERANK_TOP_K`.
3. **A query that names a section ("7 § LAS") has that section in the hybrid top 10, and a test covers that the lexical half contributes.**
   - On the real database and models, `retrieve` with "7 § LAS" (or a script) shows the LAS 7 § chunk (`SFS 1982:80 7 §`) in the hybrid top 10; quoted in the PR.
   - A unit test with a fake embedder whose dense ranking misses the target shows the target entering the fused top 10 through the lexical half alone.
4. **`RETRIEVER=tags|bge|both` is chosen in `.env` only, and the query flow works with each value.**
   - A config test covers the three values, the default `tags`, and an unknown value failing with a message naming `RETRIEVER`.
   - Query-flow tests with fakes run once per value and produce a draft; with `bge`, query translation is not called and the result reports no tags.
   - `npm run query` with fake LLM roles works with each value on a database with vectors.
5. **The storage choice is motivated in the README.**
   - A README section gives the corpus size, vector size, memory footprint, measured full-scan time on the demo machine, and why `sqlite-vec` is not needed at this size.
6. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [x] Migration: `chunk_embeddings (chunk_id, model, dtype, text_hash, dense BLOB)`, keyed so a model or dtype change re-embeds.
- [x] `index:embed` command: find stale chunks, embed in batches with progress, store.
- [x] Vector store: load into a contiguous `Float32Array` at startup, cosine top-N.
- [x] Lexical half: FTS5 BM25 over `chunks_fts` with the instruction's words, its numbers (section numbers included) and law abbreviations replaced by their SFS number (`LAS` → `1982:80`) through `replaceLawAbbreviations`.
- [x] RRF fusion with `RRF_K` and per-list weights; `both` fuses the tag ranking and the hybrid ranking the same way.
- [x] Settings: `RETRIEVER` (default `tags`), `RETRIEVE_CANDIDATES` (default 40, 30–50 recommended; **superseded by E7-4**: default 20, from its sweep), `RRF_K` (default 60), `RRF_WEIGHT_DENSE` / `RRF_WEIGHT_LEXICAL` / `RRF_WEIGHT_TAGS` (default 1); `.env.example`.
- [x] Query flow: candidates from the configured retriever; translation skipped for `bge`; candidate origin reported (`tag`, `fts`, `dense`, `lexical`).
- [x] `retrieve` CLI.
- [x] README: storage motivation and the retriever settings.
- [x] Tests with a fake embedder.

## Decisions

- **`both` fuses tags and bge by RRF** (owner): the candidate list stays ordered, so E8-5 can measure recall@K before rerank for every retriever, with the same mechanism as dense + lexical.
- **`RETRIEVER=tags` stays the default** (owner): E8-5 shows the numbers and the owner switches in `.env`.
- **`RETRIEVER=bge` skips query translation** (owner): it needs no tags, so it saves an LLM call. The result reports no tags and a translation time of 0. `both` still translates.
- **Brute-force cosine in memory** (from the issue): about 2,100 chunks × 1,024 floats ≈ 9 MB; a full scan takes milliseconds and needs no native extension. Confirmed by the measurement in criterion 5.
- **`RETRIEVE_CANDIDATES` applies to `bge` and `both`; `MAX_CANDIDATES` keeps applying to `tags`** (default): `tags` behaves exactly as today.
- **Lexical half follows E8-2's finding** (from E8-2): sparse weights if the runtime gives them, otherwise FTS5 BM25. With FTS5, known law abbreviations are expanded to their SFS number, because `source_ref` holds `SFS 1982:80 7 §`, not `LAS`.
- **Vectors keyed by chunk, model, dtype and a hash of the embedded text** (from the issue, plus dtype): int8 and fp32 vectors differ, so a dtype change re-embeds instead of mixing them.
- **Rerank in `retrieve`** (from the issue): `retrieve` uses the configured `RERANKER`; with E8-3 merged that is `bge`.
- **Builds on E8-1, E8-2 and E8-3 as merged** (spec update before implementing):
  - **No sparse output** (E8-2): the lexical half is SQLite FTS5 BM25, and `chunk_embeddings` has no sparse column.
  - **The lexical query keeps numbers of any length** (settled for this spec): E4-3's `buildFtsQuery` drops words shorter than three characters, which drops section numbers ("7", "80"), so "7 § LAS" would only match "1982". The hybrid lexical query reuses its word handling but keeps every number as an exact term, and replaces law abbreviations by their SFS number with E8-2's `replaceLawAbbreviations`, so `source_ref` (`SFS 1982:80 7 §`) matches.
  - **The embedded text is E8-2's `passageText`** (heading path and text), the same text the BGE reranker scores. The query is embedded with `kind: 'query'`, which spells out law abbreviations (E8-2).
  - **`index:embed` batches chunks of similar length** (as E8-3's reranker does), since a batch is padded to its longest text. At about 0.7–1.2 s per chunk (E8-2), a full index of ~2,100 chunks takes 25–45 minutes on the demo machine; progress is printed.
  - **The model cache is `data/models.nosync`** (E8-3) and the default reranker is `bge` (E8-3), so `retrieve` reranks with BGE unless `.env` says otherwise.
- **Settled while implementing**:
  - **Named provisions come first** (needed for criterion 3): with plain RRF, "7 § LAS" did not bring LAS 7 § into the top 10 on the real corpus. The dense half placed other LAS sections first, and the lexical half matched "7", "1982" and "80" separately, so 7 a §, 7 b § and others scored alike. A chunk whose provision the instruction names (found with E6-3's `findFreeTextReferences` and matched with the post-check's `citesSource`) is now always a candidate, ahead of the fused ranking, with origin `named`. The BM25 half still adds chunks the dense half misses (unit test).
  - **One embedding row per chunk** (`chunk_embeddings`, primary key `chunk_id`): a changed text, model or precision replaces the row. Rows are stored every 32 chunks, so an interrupted `index:embed` keeps its progress.
  - **The query flow's `search` is asynchronous, and `translate` is optional**: `bge` embeds the question, and leaves out translation.
  - **The server checks the vectors at startup** for `bge` and `both` (read-only, no model loaded) and exits with a message naming `npm run index:embed`.
  - **Measured** (criterion 5): full index 2,116 chunks in 42.9 min (int8); 8.7 MB in memory, 0.4 s load, 4.8 ms per full scan.
  - **The repo moved out of iCloud Drive** (`~/Documents/Repos` → `~/Repos`, owner's decision): iCloud renamed packages in `node_modules` into conflict copies and loaded the CPU.
- **Clean code**:
  - **Reference parsing moved to `legal/references.ts`** (from `generation/post-check.ts`): the post-check and hybrid retrieval both use it, so retrieval does not depend on the generation layer.
  - **Shared helpers**: `sha256` in `text.ts` (the judge cache and the embedding store), `countRows`, `preparedOnce` for the FTS and provision statements, one internal query builder behind `buildFtsQuery` and `buildLexicalQuery`, `namedFirst` for the named-provision merge, `FAKE_IDENTITY` and `unitLength` in the test helpers.
  - **Setup split for E8-5**: `loadRetrievalResources` loads the embedder and vectors once; `createRetriever` builds any retriever from them, so `eval:run --retriever tags,bge,both` can share one load.
  - **The server's startup check counts stale chunks only** (`assertEmbeddingsReady`), without decoding the vectors or loading a model.
- **Skipped clean-code suggestions**:
  - **Dropping the per-load text hash**: hashing 2,116 chunks takes tens of milliseconds and is what notices a chunk whose text changed.
  - **A top-N heap for the dense ranking, and one fewer BLOB copy**: under a millisecond per search.
  - **One shared retrieve/query-flow builder, and the retriever owning translation**: the two callers differ (draft vs. no draft); E8-5 decides whether eval moves onto `Retriever`.
  - **Pinning named provisions for `tags` too**: the spec keeps `tags` as it was.
- **Code review fixes**:
  - **A weight of 0 switches a ranking off**: its chunks no longer fill free places, and with `RRF_WEIGHT_DENSE=0` the question is not embedded at all.
  - **Named provisions take at most half the candidates**: a section named without its chapter matches it in every chapter, so pinning could otherwise crowd out the fused ranking.
  - **The embedder reports its own precision** (`Embedder.dtype`), and stored vectors are keyed by it, instead of reading `EMBEDDER_DTYPE` for any embedder.
  - **An empty index gives no candidates**, and a stored vector of the wrong length fails with a message naming `index:embed` instead of shifting the rows.
  - **One import of `text.ts`** in the judge cache.
- **Not changed (code review)**:
  - **`retrieve` and `query` build the whole query side** (LLM config, vocabulary, tag index) even for `RETRIEVER=bge`: the app validates the LLM config everywhere, the server included, and the tag index builds in about 10 ms.
  - **The first embedding includes loading bge-m3** (about 4 s): the README says so; the Embedder interface has no separate load step, and adding one only for timing is not worth it.

## Open Questions

- None.
