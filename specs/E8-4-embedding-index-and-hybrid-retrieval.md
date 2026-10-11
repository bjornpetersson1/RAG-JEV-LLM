# E8-4 · Embedding index and hybrid retrieval

- **Issue:** [#68](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/68)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-1 (#65), E8-2 (#66); uses E8-3 (#67) for the rerank step
- **Status:** Approved

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

- [ ] Migration: `chunk_embeddings (chunk_id, model, dtype, text_hash, dense BLOB, sparse TEXT NULL)`, keyed so a model or dtype change re-embeds.
- [ ] `index:embed` command: find stale chunks, embed in batches with progress, store.
- [ ] Vector store: load into a contiguous `Float32Array` at startup, cosine top-N.
- [ ] Lexical half: bge-m3 sparse dot product if available (E8-2), else FTS5 BM25 over `chunks_fts` with the instruction's words and law abbreviations expanded (`LAS` → `1982:80`) using E6-3's table.
- [ ] RRF fusion with `RRF_K` and per-list weights; `both` fuses the tag ranking and the hybrid ranking the same way.
- [ ] Settings: `RETRIEVER` (default `tags`), `RETRIEVE_CANDIDATES` (default 40, 30–50 recommended), `RRF_K` (default 60), `RRF_WEIGHT_DENSE` / `RRF_WEIGHT_LEXICAL` / `RRF_WEIGHT_TAGS` (default 1); `.env.example`.
- [ ] Query flow: candidates from the configured retriever; translation skipped for `bge`; candidate origin reported (`tag`, `fts`, `dense`, `lexical`).
- [ ] `retrieve` CLI.
- [ ] README: storage motivation and the retriever settings.
- [ ] Tests with a fake embedder.

## Decisions

- **`both` fuses tags and bge by RRF** (owner): the candidate list stays ordered, so E8-5 can measure recall@K before rerank for every retriever, with the same mechanism as dense + lexical.
- **`RETRIEVER=tags` stays the default** (owner): E8-5 shows the numbers and the owner switches in `.env`.
- **`RETRIEVER=bge` skips query translation** (owner): it needs no tags, so it saves an LLM call. The result reports no tags and a translation time of 0. `both` still translates.
- **Brute-force cosine in memory** (from the issue): about 2,100 chunks × 1,024 floats ≈ 9 MB; a full scan takes milliseconds and needs no native extension. Confirmed by the measurement in criterion 5.
- **`RETRIEVE_CANDIDATES` applies to `bge` and `both`; `MAX_CANDIDATES` keeps applying to `tags`** (default): `tags` behaves exactly as today.
- **Lexical half follows E8-2's finding** (from E8-2): sparse weights if the runtime gives them, otherwise FTS5 BM25. With FTS5, known law abbreviations are expanded to their SFS number, because `source_ref` holds `SFS 1982:80 7 §`, not `LAS`.
- **Vectors keyed by chunk, model, dtype and a hash of the embedded text** (from the issue, plus dtype): int8 and fp32 vectors differ, so a dtype change re-embeds instead of mixing them.
- **Rerank in `retrieve`** (from the issue): `retrieve` uses the configured `RERANKER`; with E8-3 merged that is `bge`.

## Open Questions

- None.
