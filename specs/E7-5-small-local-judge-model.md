# E7-5 · Small local judge model

- **Issue:** [#78](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/78)
- **Labels:** `E7 UI and measurement`
- **Phase:** E7 UI and measurement (ordered before E7-3)
- **Depends on:** E8-1 (#65), E8-2 (#66), E8-3 (#67), E8-5 (#69)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 863 tests (820 backend, 43 frontend) and build exit 0; `retrieve` with `RERANKER=minilm`, `bench:rerank` for minilm and bge in int8 and fp32, and `eval:run -- --reranker minilm,bge --retriever tags,bge,both` on the demo machine; the default rule held, so `RERANKER` defaults to `minilm`)

## Summary

A small multilingual cross-encoder, mMiniLM-L12 (~118M parameters), becomes `RERANKER=minilm` next to `bge`. Its latency and recall are measured against BGE on the demo machine, and it becomes the default `RERANKER` if it keeps BGE's recall@8 within 0.03 and is at least 3× faster; otherwise BGE stays the default and the report says why. (gte-multilingual-reranker-base, the second candidate, does not run on the runtime; see Decisions.)

## Goals

- `RERANKER=minilm`, one file plus one `RERANKERS` entry, reusing `loadCrossEncoder`, `passageText`, length-sorted batching, the sigmoid and `oneAtATime` from E8-3.
- Its own threshold (`RERANK_THRESHOLD_MINILM`, default 0) and the shared `RERANKER_DTYPE` / `RERANKER_BATCH_SIZE`.
- `bench:rerank` takes the reranker to measure; latency for 30 and 50 chunks, int8 and fp32, in the README.
- `eval:run -- --reranker minilm,bge --retriever tags,bge,both` rows in the report, with the default decision and its numbers.
- The licence verified and listed.

## Non-goals

- Translating the corpus or the queries to English for the English-trained models (see Decisions).
- Fine-tuning a model on our labels.
- JEV (no credits) and the `qwen3` placeholder.
- Changing the candidate count (`MAX_CANDIDATES`, `RETRIEVE_CANDIDATES`): E7-4 (#58).
- Changing BGE's behaviour or removing it.

## Acceptance Criteria

1. **`RERANKER=minilm` works through the query flow and `npm run retrieve`, added with one file and one registry entry.**
   - `npm run retrieve -- "konkurrensklausul efter anställningens slut"` with `RERANKER=minilm` prints the reranked top-K with scores on the demo machine; quoted in the PR.
   - Contract tests (E8-1's reranker contract) pass for it with a fake model.
   - A config test covers its threshold's default and an invalid value naming the variable.
2. **Rerank latency for 30 and 50 chunks on the demo machine is in the README (median of 5 runs, load time separately).**
   - `npm run bench:rerank -- --reranker minilm|bge --dtype int8|fp32`; the README table gains rows for `minilm` in both precisions next to BGE's.
   - Where an ONNX file for a precision does not exist or does not load, the row says so instead of a number.
3. **`eval:run` has rows for the new rerankers next to BGE (and LLM if run), and the report states the default decision with the numbers behind it.**
   - Rows for `minilm` and `bge` with retrievers `tags`, `bge` and `both`, appended to `eval/report-<date>.md`.
   - The rule: `minilm` becomes the default when its recall@8 after rerank is at least BGE's minus 0.03 with both `tags` and `both`, and its median rerank time is at most a third of BGE's. The report applies the rule to the numbers and states the result; `.env.example` and the README default follow it.
4. **The model's licence is verified and listed.**
   - The README licence table has the model, the ONNX file used and its licence, checked on the model card.
5. **`npm test` runs without network access or downloaded models.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [x] Catalog entry: `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` (ONNX `onnx/model.onnx`, int8 `onnx/model_quint8_avx2.onnx`) and its max tokens.
- [x] Generalise the BGE reranker's body into a shared cross-encoder reranker (model, max tokens, threshold variable), so each model is one small file.
- [x] `minilm` file and registry entry; setting in `.env.example`.
- [x] `bench:rerank --reranker`.
- [x] Measure latency; run `eval:run` on the demo machine; apply the default rule.
- [x] README: rerankers, latency table, licences, default decision.
- [x] Tests with fakes.

## Decisions

- **Measure both small models and keep the better** (owner): mMiniLM-L12 is the smallest and fastest, but mMARCO has no Swedish (its base, multilingual MiniLM, does); gte-multilingual-reranker-base is trained on Swedish among 70+ languages and sits between it and BGE in size. Two registry entries are cheap; the report decides.
- **Default rule: recall@8 within 0.03 of BGE, at least 3× faster** (owner): measured with `tags` and `both`; with 20 queries, smaller differences are noise.
- **BGE stays the default if neither qualifies** (owner); the new rerankers stay available for the demo.
- **No translation to English** (owner asked whether it is worth it; answered in the approval round): translating 2,116 chunks is a large offline LLM job, adds a query-time translation call, risks mistranslated legal terms, and would only help the English-trained part of mMiniLM. gte is trained on Swedish, so the comparison is fair for it as is. If both small models fail on Swedish, translation becomes its own issue with these numbers as the baseline.
- **Jina reranker v2 multilingual excluded** (default): CC-BY-NC-4.0, not usable in a commercial follow-up.
- **int8 for mMiniLM uses the AVX2 quantised file** (default): the demo machine's i5-8257U has AVX2, not AVX-512.

- **gte dropped; `minilm` only** (owner, before implementing): `onnx-community/gte-multilingual-reranker-base` declares the model type `new`, which transformers.js does not support (checked with 3.8.1 and with the newest, 4.3.1: "Unsupported model type: new"). A probe loaded mMiniLM in fp32 and in AVX2 int8 on E8-2's runtime; it scored two pairs in 36 ms and separated a relevant from an irrelevant chunk (logits 5.9 and −4.5).

- **Settled while implementing**:
  - **A cross-encoder is described in the catalog** (`CrossEncoderModel`: repository, max tokens, whether fp32 has external data, and an ONNX file per precision when the name is not transformers.js's default). mMiniLM's int8 file is `onnx/model_quint8_avx2.onnx`, loaded by name; BGE's fp32 weights stay in their external data file.
  - **The BGE reranker became the shared cross-encoder reranker** (`rerank/cross-encoder-reranker.ts`): `bge-reranker.ts` and `minilm-reranker.ts` are one line each, `crossEncoderReranker({ name, model })`, and each threshold is `RERANK_THRESHOLD_<NAME>`.
  - **`bench:rerank --reranker` takes any cross-encoder in the registry**: a cross-encoder entry carries its spec (`RerankerEntry.crossEncoder`), and the bench builds it directly, without the LLM settings a registry `create` needs. A new model needs no change to the bench, and the bench defaults to the app's default reranker. BGE was measured again in the same run, so both models' numbers come from the same conditions.
  - **The token limit is bound when the model loads** (`loadCrossEncoder` reads it from the model), not passed with every call.
  - **mMiniLM's pairs are cut at 512 tokens**, its position limit; the longest chunks lose their end, with a warning.
  - **The rule held** (`eval/report-2026-10-13.md`): with `tags`, recall@8 0.234 against BGE's 0.256 at 3.0 s against 27.7 s; with `both`, 0.211 against 0.230 at 4.5 s against 36.6 s. `RERANKER` now defaults to `minilm`; `.env.example` and the README follow.
  - **Measured**: `retrieve` with `RERANKER=minilm` reranked 30 candidates in 5.5 s including the model load; `bench:rerank` gives 2.69 s / 4.39 s for 30 / 50 chunks in int8 against BGE's 22.89 s / 37.68 s.

- **Code review fixes**:
  - **A precision whose ONNX file is missing or does not load gets a `not available` row** in `bench:rerank` instead of only an error (criterion 2).
  - **mMiniLM's int8 file follows the processor**: the AVX2 export on x86, the ARM export on Apple Silicon, which has no AVX2 (the ARM one is not measured here).
  - **The registry files a cross-encoder under its spec's name**, and `thresholdVariable` builds its setting's name in one place, so the two cannot drift; `localCrossEncoders` lists them for the bench and the tests, and `CrossEncoderSpec` lives in `rerank/types.ts`.
  - **The docs name `--reranker`**, now that the bench defaults to the app's default reranker; the README's local models and switching steps include `minilm`, and the `qwen3` placeholder's message names it.
- **Not changed (code review)**:
  - **`bench:rerank` imports the registry**, which loads the LLM and JEV modules it does not use: they have no side effects at import, and one registry keeps a new model to one file and one entry.
  - **`CLAUDE.md` still says the reranker is "local BGE by default"**: left to the owner.

## Open Questions

- None.
