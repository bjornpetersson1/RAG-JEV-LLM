# E7-14 · Describe the configured comparison in the UI's introduction

- **Issue:** [#108](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/108)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** none (related: E7-9 (#94), E7-11 (#98), E9-1 (#101), E7-12 (#103))
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 1055 tests (938 backend, 117 frontend; `npm test` offline under sandbox-exec, loopback only) and build exit 0; `GET /config` also checked against the real `.env`: `subq` / `llm`, cache on)

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
   - The answer is `{ "judges": { "main": { "name" }, "reference": { "name" } }, "judgeCache": boolean }`. `name` is the `RERANKER` value; the reference RAG's is always `llm`. (Changed from the approved spec, which also had `model`; see Decisions.)
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
   - Different judges with the cache on: no sentence about the reference RAG reusing the main flow's judgements. It says only that judgements from an earlier run of the same instruction can be reused, which the reference RAG's LLM judge always does.
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

- [x] Backend: `GET /config` route reading the main judge (`loadRerankerConfig`), the reference judge (`REFERENCE_RERANKER`) and `JUDGE_CACHE` from the env, registered in `server.ts` without needing the database.
- [x] Frontend: a `fetchConfig` client for `/api/config`; the introduction and demo notice built from it, with judge names by type and the neutral fallback.
- [x] Tests for criteria 1–6.
- [x] README: the endpoint, the introduction and the demo notice.
- [x] Commit `eval/report-2026-10-19.md` in this PR as its own commit.

## Decisions

- **New `GET /config`** (owner): the introduction is shown before any query, so the frontend needs the judges up front. A route of its own keeps `/health` unchanged and works without a database, like `GET /runs`.
- **Judges named by type** (owner): "en liten domarmodell (SubQ)" / "(JEV)", "en liten lokal modell (mMiniLM)" / "(BGE-reranker)", "AI-domaren (LLM)". This ties the text to the goal's "small judge model". The exact Swedish wording is settled while implementing.
- **Only the judges, not the translator** (owner): the configuration line under the timing panel already names the translator.
- **The demo notice follows `JUDGE_CACHE` too** (owner): "Domarens svar sparas" is false with the cache off. This goes beyond the issue, which conditions only the reuse sentence. It is the same kind of fix, using the same data.
- **The demo notice reads the same `/api/config`**, not the timing panel's `start` events, so the introduction and the notice can never disagree.
- **`GET /config` returns only each judge's name, not its model** (owner, while implementing). This departs from the approved spec. The model is known only once the judge is built, and only the reranker registry may branch on `RERANKER`. The introduction needs only the name, and the configuration line under the timing panel already shows the model after a run.
- **The configuration is read once, when the route is registered.** `.env` is validated at startup and does not change while the server runs.
- **An earlier run's timing panel (Tidigare körningar) gets no configuration**, so its demo notice is the neutral one. The current `.env` may not be the one that run used.
- **`stubFetch` answers `/api/config` with the default `.env`** (the LLM judge in both flows, cache on), so tests that do not care about the configuration see today's texts.
- **`eval/report-2026-10-19.md` rides along in this PR** (owner, 2026-10-19). It holds the partial benchmark of tags + SubQ against the reference RAG with the LLM judge. It is committed as written, in its own commit, and its conclusions are not revised here.
- **From code review:**
  - The UI asks for `/api/config` again every 2 s until it answers. The backend warms up its models before it listens, so a page opened meanwhile would otherwise keep the neutral text.
  - With different judges, the notice no longer says "Domarens svar sparas". A local cross-encoder (`minilm`, `bge`) saves nothing, so it says that judgements from an earlier run of the same instruction can be reused, which holds for the reference RAG's LLM judge. Criterion 5's wording was sharpened to match.
  - `JUDGE_CACHE` and the other judging settings are validated in `readStartupConfig`, so a bad value fails at startup with the plain message like every other setting.
  - The judge labels are a `Map`, so a name like `constructor` falls back to itself.
  - Not changed: the route reads `.env` again after `readStartupConfig` has validated it. That is the pattern every flow already follows, and reading is cheap.
  - Not changed: `AppConfig` is declared in both packages. That is the repo's pattern (`FlowConfiguration`, `RunLogEntry`), and there is no shared package.
  - Not changed: the neutral text shows first and is replaced when the configuration arrives. Criterion 6 asks for the neutral text while loading. On a running backend the swap happens within one request.
- **Not changed from the clean-code review:**
  - The Swedish judge labels stay in the frontend (`JUDGE_LABELS`), since UI text in Swedish lives there. An unknown `RERANKER` value shows its name.
  - The frontend decides "same judge" from the two names, which are what the API returns. A separate `sharedJudge` flag would be a second, derivable field.
  - `/config` does not return each flow's whole `FlowConfiguration`. That needs the judges' models, which are known only once built (the decision above).

## Open Questions

- None.
