# E8-2 · Local model runtime and BGE embedder

- **Issue:** [#66](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/66)
- **Labels:** `E8 Local retrieval and rerank`
- **Phase:** E8 Local retrieval and rerank
- **Depends on:** E8-1 (#65)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 676 tests (672 backend, 4 frontend) and build exit 0; `npm run embed:smoke` passes in int8 and fp32; `npm run models:bench` measured on the demo machine; decision posted on #66)

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

- [x] Spike: load `bge-m3` and `bge-reranker-v2-m3` ONNX (official or `Xenova/…` / `onnx-community/…`) with `@huggingface/transformers` in Node, fp32 and int8; check sparse output.
- [x] ~~If transformers.js fails or is unusable: Python sidecar~~ — not needed: transformers.js runs both models (see Decisions).
- [x] `models:bench` script and the measurements; README "Local models" section and #66 comment.
- [x] Licence check and README list.
- [x] Model cache in `data/models/` (configurable with `MODEL_CACHE_DIR`), downloaded on first use. (**superseded by E8-3**: the default is `data/models.nosync`)
- [x] `BgeEmbedder` (dense, normalised; sparse if available; `query`/`passage`; internal batching); registered in E8-1's factory.
- [x] Settings: `EMBEDDER_DTYPE` (`int8` default, or `fp32`), `EMBEDDER_BATCH_SIZE` (default 8), `MODEL_CACHE_DIR`; documented in `.env.example`.
- [x] `embed:smoke` script.
- [x] Tests with a fake model.

## Decisions

- **Both models in fp32 and int8 are downloaded and measured** (owner): the owner frees disk space first (4.8 GB free when the spec was written; all four variants are about 5.6 GB). If space still runs out during the spike, the epic stops and reports instead of dropping a variant.
- **A Python sidecar is acceptable as the fallback** (owner): a venv on the system Python 3.9 with pip (`uv` is not installed), FastAPI and FlagEmbedding, started by one npm script. It is only built if transformers.js fails or its performance is unusable; "unusable" is decided from the measurements and stated in the decision.
- **New dependency `@huggingface/transformers`** (owner): it brings `onnxruntime-node`; there is no built-in way to run ONNX models in Node.
- **Model cache `data/models/`** (default): already git-ignored through `/data/`, next to the database; `MODEL_CACHE_DIR` overrides it. (**superseded by E8-3**: the default is `data/models.nosync`, which iCloud Drive does not sync)
- **`EMBEDDER_DTYPE` default `int8`** (default): two fp32 models need about 4.4 GB of 8 GB RAM; the owner accepted int8 unless E8-5 shows a noticeable loss in recall.
- **Prefixes and max length** (default): bge-m3 needs no query instruction prefix; texts longer than the model's maximum (8,192 tokens) are truncated inside the embedder.
- **The reranker model is only smoke-tested here** (default): it loads and scores pairs in the spike's measurements, so E8-3 builds on the same runtime without a second spike.
- **transformers.js 3.8, not 4.x** (settled while implementing): 4.x pins onnxruntime-node 1.30, which ships no Intel macOS binary, and npm overrides to an older onnxruntime-node did not take. 3.8 uses onnxruntime-node 1.21, which runs natively on the demo machine.
- **Runtime: transformers.js, no sidecar** (from the measurements): both models load and run in Node. Embedding or scoring takes 0.7–1.2 s per chunk (`npm run models:bench`, README table; int8 up to about a quarter faster than fp32, with large run-to-run variation on the laptop); that cost is set by the models' ~568M parameters on a 4-core CPU, so a Python sidecar on the same CPU would not remove it. Peak RSS with both models loaded: 1.84 GB (int8), 2.37 GB (fp32).
- **Model repositories** (settled while implementing): `Xenova/bge-m3` (ONNX of BAAI/bge-m3, MIT) and `onnx-community/bge-reranker-v2-m3-ONNX` (ONNX of BAAI/bge-reranker-v2-m3, Apache-2.0). The reranker's fp32 weights are in an external `.onnx_data` file that its config does not declare, so the loader asks for it explicitly.
- **Sparse output is not available** (criterion 4): the ONNX export gives dense vectors only; bge-m3's sparse head (`sparse_linear.pt`) is not in any ONNX repackaging. E8-4 uses SQLite FTS5 BM25 as the lexical half; its spec is updated when E8-4 starts.
- **Law abbreviations are spelled out in queries** (owner): dense bge-m3 placed "7 § LAS" nearer Dataskyddslagen 1 kap. 7 § (0.485) than LAS 7 § (0.478), in int8 and fp32. The owner chose to spell out known abbreviations before embedding a query ("7 § LAS (Lag (1982:80) om anställningsskydd)"), after which LAS 7 § wins (0.578 against 0.474). E6-3's alias table moved to `legal/law-names.ts`, shared by the post-check and the embedder. The smoke test keeps the hard negative (the same section number in an unrelated law).
- **Passage text** (settled while implementing): a chunk is embedded as its heading path (`context`) and text. This differs from the judge's `judgedText` (source reference and text) on purpose: the heading path names the law in words, which the spelled-out abbreviations in a query match. E8-3's spec says "context + text", which is this.
- **`npm audit` advisories accepted** (owner): transformers.js 3.x brings 6 advisories (2 high in `sharp`, image processing; 4 moderate in onnxruntime-node's install-time proxy agent). No image is processed and the install script is not run; the README records them and when to move to 4.x.
- **Clean code**:
  - **transformers.js is imported on first model load** (`models/runtime.ts`), so the server, which only validates the embedder settings, and the tests never load onnxruntime.
  - **Model ids in one place** (`models/catalog.ts`): the embedder, the bench and E8-1's `bge` reranker placeholder use the same repositories.
  - **One passage text** (`passageText`, `models/passages.ts`): heading path, newline, text; E8-3 and E8-4 use it so the bench and smoke results describe what runs.
  - **`replaceLawAbbreviations(text, replace)`** is the shared matcher; `spellOutLawAbbreviations` is one use of it, and E8-4's FTS5 query can map `LAS` to `1982:80` with the same rules.
  - **`inBatches`** is shared by the embedder and the bench; `unitLength` scales in place.
- **Skipped clean-code suggestions**:
  - **Normalising in the pipeline (`normalize: true`)**: criterion 3 asks for a unit test of the normalisation, which needs it in our code.
  - **The reranker's 1,024-token limit lives in the bench for now**: E8-3 owns it and the bench will import it from there.
- **Code review fixes**:
  - **A failed model load is not cached**: the next `embed` call loads again instead of repeating the old error. `embed([])` returns at once without loading the model.
  - **The bench reports the process's peak RSS** (`process.resourceUsage().maxRSS`), which includes activations freed after each batch, and uses `EMBEDDER_BATCH_SIZE` and `MODEL_CACHE_DIR` from `.env`.
  - **Every SFS number in `LAW_ALIASES` must have a title**, checked when the module loads, so a new alias cannot embed "(undefined)".
  - **Spelling out is idempotent**: an abbreviation already followed by a parenthesis (its title) is left alone.
- **Not changed (code review)**:
  - **Cross-encoder truncation drops the closing separator**: transformers.js 3.8 cuts a pair at `max_length` without a pair-aware strategy. A chunk is at most 2,000 characters (about 700 tokens), so with an instruction a pair stays under 1,024 tokens in practice. E8-3 owns the reranker, logs truncation and handles this if it occurs.
  - **One regex for the post-check and the embedder**: the post-check matches full names and abbreviations in both capitalisations and needs offsets; the embedder matches abbreviations only, case-sensitively. They share the alias table, not the pattern.
  - **Lower-case abbreviations are not spelled out**: `dl` and `las` are ordinary words. A lower-case query keeps the dense-only behaviour, which E8-4's lexical half covers.

## Open Questions

- None.
