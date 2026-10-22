# E10-1 · Remove the local models (bge-m3, BGE reranker, mMiniLM)

- **Issue:** [#110](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/110)
- **Labels:** none
- **Phase:** E10 Remove local models
- **Depends on:** none
- **Status:** Implemented — all acceptance criteria verified (lint, format:check, typecheck, 883 backend and 117 frontend tests and build exit 0; `npm run dev`, `eval:run` and `bench:compare -- --runs 1 --limit 2 --no-draft` on the subscription, 2026-10-22, no model on disk)

## Summary

Remove the three local models and everything that only exists to run them: the bge-m3 embedder, the BGE reranker and the mMiniLM reranker, with their runtime, settings, scripts, benchmarks and UI texts. The reference RAG keeps its "no tags" search by switching from bge-m3 vectors to FTS5 BM25, so `bench:compare` still compares how candidates are found. A fresh clone then runs without downloading about 6 GB of models.

## Goals

- No code loads a local model, and `@huggingface/transformers` is gone from the dependencies.
- Every removed setting fails at startup with a message naming it, as `JUDGE_IMPL` does.
- `npm run dev`, `npm run eval:run` and `npm run bench:compare` work on a fresh clone with no model on disk.
- The reference RAG searches with BM25 over the existing `chunks_fts` table.
- README, `.env.example`, `CLAUDE.md` and the requirements describe the system as it is after the removal.

## Non-goals

- Tag search, the full-text fallback, and the LLM, SubQ and JEV judges: unchanged.
- An embedding API (e.g. Voyage or OpenAI) for hybrid retrieval. A separate follow-up issue is opened for it (see Decisions).
- Existing eval reports in `eval/`, closed specs and stored run logs: they stay as history. Old runs still load in the UI's earlier-runs view, with an unknown origin or reranker name shown as its raw value.
- Re-tuning `MAX_CANDIDATES`, `RERANK_TOP_K` or `JUDGE_THRESHOLD` for the reference RAG's new search.
- New eval runs or a new benchmark report.

## Acceptance Criteria

1. **No code imports transformers.js or loads an ONNX model; the dependency is gone from `package.json`.**
   - `grep -rE "@huggingface/transformers|onnx" backend/src frontend/src` finds nothing.
   - `@huggingface/transformers` is in neither the root nor the backend `package.json`, nor in `package-lock.json`'s direct dependencies.
   - `backend/src/embedding/` and `backend/src/models/` no longer exist, and neither do `backend/src/rerank/bge-reranker.ts`, `minilm-reranker.ts`, `cross-encoder-reranker.ts`, `qwen3-reranker.ts`, `not-implemented.ts`, `bench.ts`, `backend/src/retrieval/hybrid.ts`'s dense half, `embedding-store.ts` or `index-embeddings.ts`.

2. **Setting a removed value stops the backend at startup with a message naming the setting.**
   - Each of `RETRIEVER=bge`, `RETRIEVER=both`, `RERANKER=bge`, `RERANKER=minilm`, `RERANKER=qwen3`, and a non-empty `RETRIEVE_CANDIDATES`, `RRF_K`, `RRF_WEIGHT_DENSE`, `RRF_WEIGHT_LEXICAL`, `RRF_WEIGHT_TAGS`, `RERANK_THRESHOLD_BGE`, `RERANK_THRESHOLD_MINILM`, `RERANKER_DTYPE`, `RERANKER_BATCH_SIZE`, `MODEL_CACHE_DIR`, `EMBEDDER`, `EMBEDDER_DTYPE` and `EMBEDDER_BATCH_SIZE` makes the startup validation throw an error whose message contains the setting's name and says to remove it.
   - Unit tests cover every value in the list above.
   - `RETRIEVER` unset or `RETRIEVER=tags` still starts.

3. **`npm run dev`, `npm run eval:run` and `npm run bench:compare` work on a fresh clone without downloading any model.**
   - With no `data/models.nosync` directory and the default `.env.example` settings, `npm run dev` starts the backend; the log has no model warm-up line, and `/api/config` answers.
   - `npm run eval:run` and `npm run bench:compare` complete against the local database (with the configured LLM provider) and write their reports; no file appears under `data/models.nosync`.
   - The reference flow in `bench:compare` reports its retriever as BM25 and gets candidates.

4. **README and `.env.example` updated.**
   - Neither mentions bge-m3, the BGE reranker, mMiniLM, transformers.js, `index:embed`, `models:bench`, `bench:rerank` or any removed setting, except README naming the removed settings once in a short "removed" note.
   - README describes the reference RAG's BM25 search.
   - `CLAUDE.md`'s project summary and constraints and `Constitution/Requirements-and-goal.md`'s E5-4 text no longer mention a local embedder, `EMBEDDER`, or the local cross-encoders.

5. **`npm test` runs without network access.**
   - The canonical checks pass: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.

6. **The reference RAG searches with FTS5 BM25.**
   - Its search takes the `MAX_CANDIDATES` best chunks by BM25 for the instruction from `chunks_fts`, with origin `lexical`, and reports no embedding time.
   - A unit test over a small database shows a chunk sharing the instruction's words ranked above one that does not.

## Tasks

- [x] Delete `backend/src/embedding/`, `backend/src/models/`, the cross-encoder rerankers, the qwen3 placeholder and `rerank/bench.ts`, with their tests.
- [x] In `backend/src/retrieval/`: keep tag retrieval (the BM25 helpers move to `reference/lexical-search.ts`); remove the dense ranking, fusion, embedding store, `index-embeddings.ts` and the `embed` CLI command.
- [x] Remove `RETRIEVER=bge|both` and the other settings in criterion 2 from config; reject each with a named message.
- [x] Remove the model warm-up from the server and API setup.
- [x] Reference RAG: replace dense search with BM25 search; update its configuration label and `createReferenceFlow`'s signature.
- [x] Eval: drop `--retriever` and the local rerankers from `eval:run --reranker`; the sweep sweeps `MAX_CANDIDATES` for tag search only, with the configured `RERANKER`; drop the local variants from `bench:compare`.
- [x] Remove `embedMs` / `embeddingMs` from the flows, the timing output and the UI's timing panel.
- [x] UI: drop the texts and labels about the local models and vector search; describe the reference RAG's BM25 search in Swedish.
- [x] Migration `0009` drops `chunk_embeddings`.
- [x] Remove the npm scripts `index:embed`, `models:bench`, `bench:rerank` and the `@huggingface/transformers` dependency.
- [x] Update README, `.env.example`, `CLAUDE.md` and the requirements' E5-4 text.

## Decisions

- **Key E10-1, new epic E10 "Remove local models"** (owner). The issue had no key and was not on the board; it is renamed and added to the board.
- **The reference RAG searches with FTS5 BM25** (owner). Best practice is hybrid retrieval (dense embeddings + BM25), but without a local model the dense half needs an embedding API: a new key, cost, re-indexing and keeping the embedder interface. Tags are ruled out because the main flow already searches with tags, and the comparison would then compare the flow with itself. BM25 is the classic lexical RAG baseline, local and free. A follow-up issue for hybrid retrieval with an embedding API is opened when this spec is approved. It departs from the issue's list of options only in deferring the API option.
- **The reference RAG uses plain BM25**, without the "named provision first" rule the hybrid retriever had, so it stays a standard baseline and does not borrow the main flow's legal heuristics.
- **The Embedder interface is removed entirely** (owner), and `CLAUDE.md` and the requirements are updated to match. The follow-up issue would bring back an interface if it is built.
- **The sweep stays, tag search only** (owner): it sweeps `MAX_CANDIDATES` with the configured `RERANKER` (the LLM judge by default) instead of mMiniLM.
- **The qwen3 placeholder is removed too** (default): it is a registered local model that was never built, and the issue's intent is no local models. `RERANKER=qwen3` is rejected like the others.
- **`RETRIEVER` stays readable but only accepts `tags`** (default): unset or `tags` starts, `bge` and `both` are rejected by name. It is dropped from `.env.example` since it has no choice left.
- **`chunk_embeddings` is dropped by a new migration** (default). The vectors can no longer be produced or read, and they take space in `rag.db`.
- **`npm run retrieve` stays** (default): it runs the configured tag retrieval and judge, which are in scope to keep.
- **The model files were deleted from the owner's machine** (owner's request, 2026-10-21): `data/models.nosync` (6.4 GB, git-ignored), before this spec. `@huggingface/transformers` and its ONNX runtime leave `node_modules` when the dependency is removed.
- **Branch name shortened** to `feature/E10-1-remove-the-local-models`; the spec file uses the same slug.
- **One module rejects the removed settings, at each entry point** (implementation, after clean code): `backend/src/removed-settings.ts`. The server's startup validation and the CLIs that build a flow (`query`, `retrieve`, `eval:*` and `bench:compare`) call it first, so all fail the same way; the config loaders stay free of a global check. `JUDGE_IMPL` and `REFERENCE_TOP_K` keep their own older checks, outside this issue's diff.
- **Both flows are built at server start** (implementation): without an embedder or vectors to load, the reference RAG can no longer fail late, so the lazy build and the warm-up go. The route keeps its `skipped` event for a flow that cannot be built.
- **Report tables** (implementation): the comparison drops its `dtype` column and `bench:compare` its `embedding` column. The benchmark table gets a new heading ("Main flow vs BM25 reference RAG: the same judge"), as E7-9 did, so new rows never land under an older header; the comparison table keeps its heading, and today's reports have no rows under it yet.
- **`eval:label` lists the reference RAG's BM25 candidates** (implementation), marked `reference` instead of `dense`, so E7-10's purpose (label what the reference RAG finds) still holds.
- **Code that only served the local models goes too** (implementation): the candidate origins `dense` and `named` (and the hybrid retriever's "named provision first" rule), `spellOutLawAbbreviations` (the embedder's query rewrite), `Reranker.dtype` and `modelLabel`, the `embed:smoke` script, the `sharp` override (only transformers.js pulled `sharp` in), and `SearchSetup.candidateSearch`.
- **The sweep's and comparison's harnesses stay generic** (implementation): `SweptRetriever.usesTags`, `ComparedRetriever` and the reranker registry's `remote` flag are kept; tests use fakes that are not remote.
- **Verification run not kept** (verification): the 2-query `bench:compare` that proved criterion 3 appended to `eval/report-2026-10-22.md`; that file was deleted, since a 2-query run is not a benchmark result.
- **Stale dev servers stopped** (owner, 2026-10-22): old `npm run dev` processes from 11–16 Oct restarted on the old code during this work and downloaded bge-m3 again; they were stopped and `data/models.nosync` deleted again.
- **Code review: the sweep's LLM default stays** (owner's decision above). Review noted that an unset `RERANKER` now sweeps with the uncached LLM judge instead of minilm. That is the owner's choice; like `eval:run` and `bench:compare`, the sweep asks first only for SubQ, and the README says to run it on the subscription.
- **Code review: `RerankResult.judged` stays** although every remaining reranker sets it: the UI's ranking branch and the result shape are outside this issue's diff, and removing them is a separate cleanup.
- **Code review: the comparison's SubQ estimate counts both lists** (tag search and the full-text baseline, up to `MAX_CANDIDATES` each), which the earlier estimate left out.
- **Code review: one BM25 statement** (`bm25Ranking` in `search/candidate-search.ts`) serves the full-text fallback and the reference RAG.
- **Historical numbers in the README stay** (implementation), reworded to say the local ranker or vector search was removed, so the README names the removed models only in its "Removed local models" note.

## Open Questions

- none
