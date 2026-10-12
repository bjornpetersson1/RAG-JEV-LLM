# E7-5 · Small local judge model

- **Issue:** [#78](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/78)
- **Labels:** `E7 UI and measurement`
- **Phase:** E7 UI and measurement (ordered before E7-3)
- **Depends on:** E8-1 (#65), E8-2 (#66), E8-3 (#67), E8-5 (#69)
- **Status:** Approved

## Summary

Two small multilingual cross-encoders become `RERANKER` values next to `bge`: `minilm` (mMiniLM-L12, ~118M parameters) and `gte` (gte-multilingual-reranker-base, ~306M). Their latency and recall are measured against BGE on the demo machine, and the better one becomes the default `RERANKER` if it keeps BGE's recall@8 within 0.03 and is at least 3× faster; otherwise BGE stays the default and the report says why.

## Goals

- `RERANKER=minilm` and `RERANKER=gte`, each one file plus one `RERANKERS` entry, reusing `loadCrossEncoder`, `passageText`, length-sorted batching, the sigmoid and `oneAtATime` from E8-3.
- Their own thresholds (`RERANK_THRESHOLD_MINILM`, `RERANK_THRESHOLD_GTE`, default 0) and the shared `RERANKER_DTYPE` / `RERANKER_BATCH_SIZE`.
- `bench:rerank` takes the reranker to measure; latency for 30 and 50 chunks, int8 and fp32, in the README.
- `eval:run -- --reranker minilm,gte,bge --retriever tags,bge,both` rows in the report, with the default decision and its numbers.
- Licences verified and listed.

## Non-goals

- Translating the corpus or the queries to English for the English-trained models (see Decisions).
- Fine-tuning a model on our labels.
- JEV (no credits) and the `qwen3` placeholder.
- Changing the candidate count (`MAX_CANDIDATES`, `RETRIEVE_CANDIDATES`): E7-4 (#58).
- Changing BGE's behaviour or removing it.

## Acceptance Criteria

1. **`RERANKER=minilm` and `RERANKER=gte` work through the query flow and `npm run retrieve`, each added with one file and one registry entry.**
   - `npm run retrieve -- "konkurrensklausul efter anställningens slut"` with each value prints the reranked top-K with scores on the demo machine; quoted in the PR.
   - Contract tests (E8-1's reranker contract) pass for both with a fake model.
   - A config test covers each threshold's default and an invalid value naming the variable.
2. **Rerank latency for 30 and 50 chunks on the demo machine is in the README (median of 5 runs, load time separately).**
   - `npm run bench:rerank -- --reranker minilm|gte|bge --dtype int8|fp32`; the README table gains rows for `minilm` and `gte` in both precisions next to BGE's.
   - Where an ONNX file for a precision does not exist or does not load, the row says so instead of a number.
3. **`eval:run` has rows for the new rerankers next to BGE (and LLM if run), and the report states the default decision with the numbers behind it.**
   - Rows for `minilm`, `gte` and `bge` with retrievers `tags`, `bge` and `both`, appended to `eval/report-<date>.md`.
   - The rule: a new reranker becomes the default when its recall@8 after rerank is at least BGE's minus 0.03 with both `tags` and `both`, and its median rerank time is at most a third of BGE's. With both qualifying, the faster one wins. The report applies the rule to the numbers and states the result; `.env.example` and the README default follow it.
4. **The models' licences are verified and listed.**
   - The README licence table has both models, the ONNX repository used and the base model's licence, checked on the model cards.
5. **`npm test` runs without network access or downloaded models.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [ ] Catalog entries: `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` (ONNX `onnx/model.onnx`, int8 `onnx/model_quint8_avx2.onnx`) and `onnx-community/gte-multilingual-reranker-base`; their max tokens.
- [ ] Generalise the BGE reranker's body into a shared cross-encoder reranker (model, max tokens, threshold variable), so each model is one small file.
- [ ] `minilm` and `gte` files and registry entries; settings in `.env.example`.
- [ ] `bench:rerank --reranker`.
- [ ] Measure latency; run `eval:run` on the demo machine; apply the default rule.
- [ ] README: rerankers, latency table, licences, default decision.
- [ ] Tests with fakes.

## Decisions

- **Measure both small models and keep the better** (owner): mMiniLM-L12 is the smallest and fastest, but mMARCO has no Swedish (its base, multilingual MiniLM, does); gte-multilingual-reranker-base is trained on Swedish among 70+ languages and sits between it and BGE in size. Two registry entries are cheap; the report decides.
- **Default rule: recall@8 within 0.03 of BGE, at least 3× faster** (owner): measured with `tags` and `both`; with 20 queries, smaller differences are noise.
- **BGE stays the default if neither qualifies** (owner); the new rerankers stay available for the demo.
- **No translation to English** (owner asked whether it is worth it; answered in the approval round): translating 2,116 chunks is a large offline LLM job, adds a query-time translation call, risks mistranslated legal terms, and would only help the English-trained part of mMiniLM. gte is trained on Swedish, so the comparison is fair for it as is. If both small models fail on Swedish, translation becomes its own issue with these numbers as the baseline.
- **Jina reranker v2 multilingual excluded** (default): CC-BY-NC-4.0, not usable in a commercial follow-up.
- **int8 for mMiniLM uses the AVX2 quantised file** (default): the demo machine's i5-8257U has AVX2, not AVX-512.

## Open Questions

- None.
