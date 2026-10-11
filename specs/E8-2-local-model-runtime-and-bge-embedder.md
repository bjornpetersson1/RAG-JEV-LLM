# E8-2 · Local model runtime and BGE embedder

- **Issue:** [#66](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/66)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-1 (#65)
- **Status:** Approved

## Summary

A measured spike decides how `BAAI/bge-m3` and `BAAI/bge-reranker-v2-m3` run locally on the demo machine — directly in Node with transformers.js (ONNX), or in a small Python sidecar — and `BgeEmbedder` replaces E8-1's placeholder on that runtime, returning normalised dense vectors and, if the runtime gives them, sparse weights.

## Goals

- A runtime spike with measurements on the demo machine (Intel Core i5-8257U, 8 GB RAM, no GPU), for both models in fp32 and int8.
- A documented runtime decision, in the README and as a comment on #66.
- Verified model licences in the README.
- `BgeEmbedder` implementing E8-1's `Embedder` for queries and passages, with internal batching.
- Models downloaded once into a git-ignored cache.
- A smoke script showing that bge-m3 places "7 § LAS" nearer the right section than an unrelated one.
- A stated answer on sparse output, which decides E8-4's lexical half.

## Non-goals

- `BgeReranker` (E8-3); this issue only measures that the reranker model loads and runs on the chosen runtime, so E8-3 does not need a second spike.
- Embedding all chunks, the vector store and retrieval (E8-4).
- Choosing fp32 or int8 as the final default on recall grounds (E8-5 measures it).
- A GPU path, or any hosted embedding API.
- Fine-tuning or other models (e.g. Qwen3).

## Acceptance Criteria

1. **The runtime decision (transformers.js or sidecar), with its reasons and measurements on the demo machine, is documented in the README and on this issue.**
   - Measured for each model in fp32 and int8: model load time, peak memory (RSS) with both models loaded, and time to embed 100 real chunks (bge-m3) / score 100 (query, chunk) pairs (reranker).
   - The README has a "Local models" section with the table and the decision; the same content is posted as a comment on #66 (`gh issue comment`).
   - The measuring script is committed (e.g. `npm run models:bench`), so the numbers can be reproduced.
2. **The licences of the models used are verified and listed in the README.**
   - For each model and each ONNX repackaging used: the repository, its licence as stated on the Hugging Face model card, and the date checked.
3. **`EMBEDDER=bge` embeds a Swedish query and a chunk, and a smoke script shows that "7 § LAS" is closer to the right section than to an unrelated one.**
   - `npm run embed:smoke` embeds the query "7 § LAS" and two chunks from the database: LAS 7 § (SFS 1982:80) and a section from an unrelated law. It prints both cosine similarities and exits non-zero unless the LAS 7 § chunk scores higher.
   - Dense vectors returned by `BgeEmbedder` have length 1,024 and unit norm (checked in the smoke script and, with a fake model, in a unit test of the normalisation).
4. **Whether sparse output is supported is stated. If it is not, E8-4 uses SQLite FTS5 BM25 as the lexical half.**
   - The README and the #66 comment say whether bge-m3's sparse (lexical weight) output is available on the chosen runtime.
   - If available, `BgeEmbedder` returns it as `sparse`; if not, `sparse` is absent and the spec of E8-4 is updated to use FTS5 BM25 before it is implemented.
5. **`npm test` runs without network access or downloaded models.**
   - Tests use a fake model or a fake sidecar fetch; no test reads the model cache.
6. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0.

## Tasks

- [ ] Spike: load `bge-m3` and `bge-reranker-v2-m3` ONNX (official or `Xenova/…` / `onnx-community/…`) with `@huggingface/transformers` in Node, fp32 and int8; check sparse output.
- [ ] If transformers.js fails or is unusable: Python sidecar in `python/` (venv, FastAPI, FlagEmbedding) with `/embed` and `/rerank`, started by one npm script; TypeScript client for it.
- [ ] `models:bench` script and the measurements; README "Local models" section and #66 comment.
- [ ] Licence check and README list.
- [ ] Model cache in `data/models/` (configurable with `MODEL_CACHE_DIR`), downloaded on first use.
- [ ] `BgeEmbedder` (dense, normalised; sparse if available; `query`/`passage`; internal batching); registered in E8-1's factory.
- [ ] Settings: `EMBEDDER_DTYPE` (`int8` default, or `fp32`), `MODEL_CACHE_DIR`, and the sidecar URL if a sidecar is used; documented in `.env.example`.
- [ ] `embed:smoke` script.
- [ ] Tests with a fake model.

## Decisions

- **Both models in fp32 and int8 are downloaded and measured** (owner): the owner frees disk space first (4.8 GB free when the spec was written; all four variants are about 5.6 GB). If space still runs out during the spike, the epic stops and reports instead of dropping a variant.
- **A Python sidecar is acceptable as the fallback** (owner): a venv on the system Python 3.9 with pip (`uv` is not installed), FastAPI and FlagEmbedding, started by one npm script. It is only built if transformers.js fails or its performance is unusable; "unusable" is decided from the measurements and stated in the decision.
- **New dependency `@huggingface/transformers`** (owner): it brings `onnxruntime-node`; there is no built-in way to run ONNX models in Node.
- **Model cache `data/models/`** (default): already git-ignored through `/data/`, next to the database; `MODEL_CACHE_DIR` overrides it.
- **`EMBEDDER_DTYPE` default `int8`** (default): two fp32 models need about 4.4 GB of 8 GB RAM; the owner accepted int8 unless E8-5 shows a noticeable loss in recall.
- **Prefixes and max length** (default): bge-m3 needs no query instruction prefix; texts longer than the model's maximum (8,192 tokens) are truncated inside the embedder.
- **The reranker model is only smoke-tested here** (default): it loads and scores pairs in the spike's measurements, so E8-3 builds on the same runtime without a second spike.

## Open Questions

- None.
