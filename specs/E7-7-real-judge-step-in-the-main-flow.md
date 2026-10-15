# E7-7 · Real judge step in the main flow

- **Issue:** [#90](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/90)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** none (related: E7-6 (#79), E7-5 (#78), E7-4 (#58))
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 926 tests (867 backend, 59 frontend; `npm test` offline under sandbox-exec) and build exit 0; `eval:run` with the Haiku judge on the subscription (threshold 0.8, `eval/report-2026-10-13.md`); `bench:compare --runs 1 --no-draft` with `llm` and `minilm`; `npm run dev` with `RERANKER=llm`: "4 bedömda som relevanta av 30" and the rerank row 30.5 s in the timing panel)

## Summary

The main flow gets back the judge step the requirements describe. Each candidate chunk is judged relevant or not against `JUDGE_THRESHOLD`, in parallel per chunk, and only chunks at or above the threshold reach the generator. Until JEV can be used, the default is the LLM judge (`RERANKER=llm`) with Haiku as its model. The threshold is set from a new sweep against the central labels. The UI wording says what the step did. The judge's cost in time is measured against minilm and the reference RAG.

## Goals

- `RERANKER=llm` is the default. `minilm`, `bge` and `jev` stay selectable in `.env`.
- The judge uses its own model, `LLM_JUDGE_MODEL=claude-haiku-5-5` in `.env.example`.
- `JUDGE_THRESHOLD` is set from an `eval:run` sweep with the Haiku judge, against the central labels.
- A query with no candidate at or above the threshold writes no draft, and the UI says so.
- The UI says "N bedömda som relevanta av M" for a judge, and "N högst rankade av M" for a ranker without a threshold.
- The judge's time per query and per chunk is measured and compared with minilm and the reference RAG, in the report.

## Non-goals

- **A minilm pre-filter before the judge.** The owner chose to measure first. If the judge is too slow, the pre-filter becomes its own issue, with the numbers behind it.
- **JEV.** That is #79. It replaces the LLM judge through the same `RERANKER` value once credits exist.
- **The fair total-time comparison.** "Time to sources", and generation normalised or length-limited, are #91.
- **Changes to the reference RAG.**
- **Calibrating a threshold for minilm or bge.**
- **Changing the candidate counts.** `MAX_CANDIDATES`, `RETRIEVE_CANDIDATES` and `RERANK_TOP_K` stay at E7-4's values. `RERANK_TOP_K` stays a cap.
- **New judge prompts or a new judge implementation.** E5-1/E5-2's LLM judge is used as it is.

## Acceptance Criteria

1. **With the default configuration, the main flow keeps only chunks the judge scored at or above the threshold, and a query with no relevant candidate writes no draft.**
   - The default `RERANKER` is `llm`. A config test covers the default, and `.env.example` and the README say so.
   - A query-flow test with a fake judge proves the threshold rule. With some scores below `JUDGE_THRESHOLD` and some at or above it, only the latter reach the generator, in score order, capped at `RERANK_TOP_K`.
   - A test proves that when every score is below the threshold, no generator call is made. The result has no draft, and the NDJSON stream still ends with `result` and `done`.
   - A frontend test shows the existing "Inget utkast skrevs: inga relevanta källor hittades." text for that result.
2. **`JUDGE_THRESHOLD` is set from a measurement on the evaluation set, and the report states the numbers.**
   - `npm run eval:run` runs with `RERANKER=llm`, `LLM_JUDGE_MODEL=claude-haiku-5-5` and the Claude Code subscription. The threshold sweep covers precision, recall and F1 against the central chunks and against all graded chunks.
   - The threshold with the highest central F1 becomes the default in `.env.example`, the config default and the README.
   - `eval/report-<date>.md` gets the sweep table and a short analysis.
3. **The UI wording matches what the step did.**
   - The rerank step event carries whether a threshold decided relevance (`judged`) and how many candidates were scored.
   - With a judge, the flow shows "N bedömda som relevanta av M". With a ranker without a threshold (a cross-encoder at threshold 0), it shows "N högst rankade av M".
   - Frontend tests cover both wordings.
4. **The judge's time is measured, and the report compares it with minilm and the reference RAG.**
   - `npm run bench:compare -- --runs 1 --no-draft` runs once with `RERANKER=llm` and once with `RERANKER=minilm`, judge cache off. Both are appended to the report.
   - The report states, per flow, the median and p90 of total time (without generation), search and rerank time, and the judge's time per chunk.
   - The timing panel shows the judge's time on the rerank row, as it already does for any reranker. This is checked in the dev server with `RERANKER=llm`.
5. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.

## Tasks

- [x] Make `llm` the default `RERANKER`, and set `LLM_JUDGE_MODEL=claude-haiku-5-5` in `.env.example`. Update the README, `.env.example`, `CLAUDE.md`'s one-line description, and the config tests.
- [x] Rerank step event: `judged` and the number of scored candidates. Set `judged` from the reranker, so that a threshold above 0 counts as judged.
- [x] Frontend: the two wordings, and the no-draft text for a result without approved chunks. Add tests.
- [x] Query-flow tests: the threshold rule, and no relevant candidate → no generator call.
- [x] Run the threshold sweep with the Haiku judge on the subscription. Set `JUDGE_THRESHOLD` and write up the report.
- [x] Run `bench:compare --runs 1 --no-draft` with `llm` and with `minilm`, and write up the report.
- [x] Check the dev server with `RERANKER=llm`: judge time in the timing panel and the wording.

## Decisions

- **`llm` is the default until JEV works** (owner). The requirements' query step 3 is a yes/no judge with a threshold. minilm (E7-5) only ranks, since its threshold is 0, so the main flow had no judge. JEV stays blocked (#79).
- **No pre-filter yet; measure first** (owner). The judge scores every candidate, at most 30 with `tags`, in parallel with `JUDGE_CONCURRENCY` (8). If its time is too high, a minilm pre-filter becomes its own issue.
- **Haiku as the judge model** (owner). It is the closest to the requirements' "small judge model" that is available, and the fastest and cheapest per call. Measurements run through the Claude Code subscription (`LLM_PROVIDER=claude-code`, with the env API key overridden), as for every eval run.
- **The threshold comes from a new sweep against the central labels** (owner). E5-3's 0.6 was measured with another model on ungraded labels.
- **The judge cache stays on in the query flow** (default). A repeated demo query costs no new calls. The benchmark and the sweep run with the cache off, as before, so their times are real.
- **`judged` comes from the reranker, not the flow name or reranker name** (default). That way, a cross-encoder given a threshold, or JEV, gets the right wording without any special cases.
- **The benchmark runs once (`--runs 1`) and without drafts** (default). Five runs of 20 queries with about 30 judge calls each would be about 3,000 calls on the subscription, and an earlier benchmark lost pairs to the session limit. Generation time belongs to #91.

- **Settled while implementing:**
  - **`judged` lives on `RerankResult`**: the judge rerankers set it true, a cross-encoder when its threshold is above 0. The flow passes it on in the rerank step event with `candidates` (the scored count), so the UI never looks at the reranker's name.
  - **The judge wording names the cap**: "N bedömda som relevanta av M" when every relevant chunk is sent, and ", de K bästa skickas till generatorn" when `RERANK_TOP_K` cut some.
  - **`eval:run`'s threshold sweep is now per grade** (`sweeps[mode].central` / `.all`, both in the terminal and the Markdown report), and the recommendation is the central sweep's best F1, as criterion 2 asks; before, it swept against all graded chunks only.
  - **`JUDGE_THRESHOLD` 0.5 → 0.8** from that sweep (central F1 0.388 against 0.230 at 0.5); tests that relied on the 0.5 default pin it explicitly.
  - **`bench:rerank` defaults to `minilm`** (it only measures local cross-encoders), no longer to the default `RERANKER`.
  - **Measured cost** (`eval/report-2026-10-13.md`): time to sources 35.2 s with the judge (27.1 s judging through the Claude Code CLI), 10.8 s with minilm, 0.05 s for the reference RAG; precision 0.440, 0.350 and 0.287.

- **Code review (high):**
  - **Unknown chunks are named.** The rerank step event carries `unknown`; the UI adds "(N kunde inte bedömas)", and a result without a draft says "inga källor bedömdes som relevanta, och N kunde inte bedömas", so a failing judge (CLI error, session limit, timeout) does not look like "nothing relevant".
  - **The threshold sweep keeps at most `RERANK_TOP_K` per query, best first**, as the query flow does, so the threshold is tuned for the production rule. The judges themselves still keep every relevant chunk, so the mode table stays comparable with earlier runs. Re-run: 0.8 still has the best central F1 (0.356 against 0.305 at 0.5).
  - **The default threshold is per judge**: 0.8 for `llm`, 0.5 for `jev` until #79, so JEV's default does not move on a Haiku measurement. `.env.example` leaves `JUDGE_THRESHOLD` empty.
  - **A blank `LLM_JUDGE_MODEL` means Haiku** (a per-role default in the LLM config, before `LLM_MODEL`), so the code default matches the threshold's calibration and does not judge with Opus.
  - **The candidate sweep (`eval:run -- --sweep`) uses minilm unless `RERANKER` is set**, so it does not make thousands of uncached judge calls by default and stays comparable with E7-4's rows.
  - **Wording**: ", de K bästa går vidare" instead of "skickas till generatorn", since the context limits may still leave some out.
  - **A query-flow test with the real (fake-LLM) judge** shows both sides of `JUDGE_THRESHOLD` and the `RERANK_TOP_K` cap.
  - **Declined: one shared type for the step events.** The frontend copies every event type from the backend; there is no shared package, and adding one is outside this issue.

## Open Questions

- None.
