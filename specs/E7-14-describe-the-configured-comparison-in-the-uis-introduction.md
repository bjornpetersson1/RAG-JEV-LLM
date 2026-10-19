# E7-14 · Describe the configured comparison in the UI's introduction

- **Issue:** [#108](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/108)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** none (related: E7-9 (#94), E7-11 (#98), E9-1 (#101), E7-12 (#103))
- **Status:** Approved

## Summary
The UI's introduction and demo notice describe the comparison `.env` actually configures. When the main flow's judge is not the LLM (e.g. `RERANKER=subq`), that comparison is the POC's goal: tag search plus a small judge against a regular RAG with an LLM judge. A new `GET /api/config` tells the frontend the configured judges and judge cache before a query runs.

## Goals
- `GET /config` on the backend (`/api/config` through the dev proxy) returns each flow's judge and whether the judge cache is on, read from `.env` without building the flows.
- The introduction states which judge each flow uses and what the comparison therefore measures.
- The demo notice claims only what holds: saved judge answers only with the cache on, and reused judgements only with the cache on and the same judge in both flows.
- README describes the endpoint and the new texts.

## Non-goals
- Changing which judge either flow uses, or the reference RAG's design (`REFERENCE_RERANKER` stays `llm`).
- Naming the query translator in the introduction (the configuration line under the timing panel already shows it).
- The info texts per measure, including the comparison's (i) text.
- Rewriting the conclusions of `eval/report-2026-10-19.md` (it is committed as written; see Decisions).

## Acceptance Criteria
1. **`GET /config` returns the configured judges and judge cache.**
   - The answer is `{ "judges": { "main": { "name", "model" }, "reference": { "name", "model" } }, "judgeCache": boolean }`. `name` is the `RERANKER` value (the reference RAG's is always `llm`), and `model` is the judge's model label.
   - It answers without a database and builds no flow or model.
   - Proved by a test in `backend/src/api/config-route.test.ts` with `RERANKER=subq` and `RERANKER=llm`, and with `JUDGE_CACHE=off`.
2. **With `RERANKER=subq`, the introduction names the main flow's small judge and the reference RAG's LLM judge, and does not say they use the same judge.**
   - It says the main flow's judge is a small judge model (SubQ), the reference RAG's is the AI judge (LLM), and that the difference is both how the sources are found and how they are judged.
   - Proved by a frontend test.
3. **With `RERANKER=llm`, the introduction says both use the same judge, as today.**
   - The text is today's: same AI judge and the same AI writing the draft, so the difference is in how the sources are found.
   - Proved by a frontend test.
4. **The introduction names other judges by type.**
   - `jev`: a small judge model (JEV). `minilm` and `bge`: a small local model (mMiniLM or BGE-reranker). Any other value: its `RERANKER` name.
   - Proved by a frontend test (at least `minilm`).
5. **The demo notice mentions reusing judgements only when both flows use the same judge, and saved answers only with the judge cache on.**
   - Same judge with the cache on: today's notice.
   - Different judges with the cache on: no sentence about reuse.
   - Cache off: no sentence about saved answers or reuse.
   - All variants keep the sentences that the UI's figures are a demonstration and that `npm run bench:compare` is the measurement.
   - Proved by a frontend test of the three variants.
6. **Without a reachable backend or configuration, the introduction still renders with a neutral text.**
   - While `/api/config` is loading, or when it fails, the introduction says what the two flows do without any claim about the judges, and the demo notice says nothing about saved or reused judgements.
   - Proved by a frontend test with a failing `fetch`.
7. **README updated.**
   - It documents `GET /config` (shape and that it reads `.env`). The E7-11 lines about the introduction ("tags against vectors, with the same judge and generator") and the demo notice describe the configured texts.
8. **`npm test` runs without network access.**
   - The canonical checks pass: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.

## Tasks
- [ ] Backend: `GET /config` route reading the main judge (`loadRerankerConfig`), the reference judge (`referenceJudgeEnv`) and `JUDGE_CACHE` from the env, registered in `server.ts` without needing the database.
- [ ] Frontend: a `fetchConfig` client for `/api/config`; the introduction and demo notice built from it, with judge names by type and the neutral fallback.
- [ ] Tests for criteria 1–6.
- [ ] README: the endpoint, the introduction and the demo notice.
- [ ] Commit `eval/report-2026-10-19.md` in this PR as its own commit.

## Decisions
- **New `GET /config`** (owner): the introduction is shown before any query, so the frontend needs the judges up front. A route of its own keeps `/health` unchanged and works without a database, like `GET /runs`.
- **Judges named by type** (owner): "en liten domarmodell (SubQ)" / "(JEV)", "en liten lokal modell (mMiniLM)" / "(BGE-reranker)", "AI-domaren (LLM)". This ties the text to the goal's "small judge model". The exact Swedish wording is settled while implementing.
- **Only the judges, not the translator** (owner): the configuration line under the timing panel already names the translator.
- **The demo notice follows `JUDGE_CACHE` too** (owner): "Domarens svar sparas" is false with the cache off. This goes beyond the issue, which conditions only the reuse sentence. It is the same kind of fix, using the same data.
- **The demo notice reads the same `/api/config`**, not the timing panel's `start` events, so the introduction and the notice can never disagree.
- **`model` is the label the configuration line already uses** (`modelLabel`, e.g. `subq-snap-preview`, `claude-haiku-5-5`), so the API and the panel name a model the same way.
- **`eval/report-2026-10-19.md` rides along in this PR** (owner, 2026-10-19). It holds the partial benchmark of tags + SubQ against the reference RAG with the LLM judge. It is committed as written, in its own commit, and its conclusions are not revised here.

## Open Questions
- None.
