# E9-1 · SubQ judge and query translator

- **Issue:** [#101](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/101)
- **Labels:** `E9 SubQ`
- **Phase:** E9 SubQ
- **Depends on:** none
- **Status:** Implemented — all acceptance criteria verified (lint, format:check, typecheck, 936 backend and 90 frontend tests, build exit 0; live SubQ runs 2026-10-15, 0.047 USD)

## Summary

Add SubQ Snap (`subq-snap-preview`, https://docs.subq.ai) as a judge (`RERANKER=subq`) and as a query translator (`QUERY_TRANSLATOR_IMPL=subq`). It goes through the client JEV already uses, generalised into one System One client. Measure SubQ against the LLM judge and the local rankers on the existing evaluation set, and make it the default wherever the pre-agreed rules say it wins. Every batch script that would call the paid SubQ API first prints a cost estimate and needs a confirmation.

## Goals

- SubQ is selectable for both model roles JEV has, with the same behaviour as JEV: the same question, cache, fallback, timeouts and logging.
- Nothing outside the System One client and its per-provider settings knows which of JEV or SubQ it talks to.
- No batch run calls SubQ without the owner having seen an estimate and confirmed it.
- Live numbers decide the defaults: the limits from a probe, and an evaluation with statutes and rulings reported separately.

## Non-goals

- Removing JEV. JEV's code, settings, `jev:probe` and the `tags+jev` mode stay and keep passing their tests. JEV is documented as paused, and #79 stays open.
- SubQ's other endpoints (Chat Completions, Responses, Files, Conversations) and the `subq-preview` chat model.
- `score` questions, `noul` `criteria`, images, and several chunks per call.
- A cost guard for single queries (`npm run query`, the web UI).
- The owner's review of `eval/queries.yaml` (#79) and new labels.
- Retries, and handling rate limits beyond reporting them.
- Zero data retention. The owner requests it from SubQ if wanted; nothing in the code depends on it.

## Acceptance Criteria

1. **`RERANKER=subq` judges chunks through the SubQ client.** Tests with a faked SubQ API (an injected `fetch`) prove each of these:
   - **Request:** `POST <SUBQ_BASE_URL>/systemone` with `Authorization: Bearer <key>`, `model` set to `SUBQ_MODEL`, the judged text (`judgedText`) as `state`, and one `noul` question whose instructions are `relevanceQuestion(instruction)`.
   - **Score:** the score is the answer's `noul`. The chunk is relevant when the score is at least `JUDGE_THRESHOLD`, and `judgedBy` is `subq`.
   - **Fallback:** on HTTP 4xx, HTTP 5xx, a timeout, a network error and a malformed answer, the judge's LLM answers that chunk instead and a warning is logged. The warning names the chunk and the cause. For a 402 it says SubQ is out of credits, and for any HTTP error it includes SubQ's `detail.error_type` and `detail.message` when the body has them. A cancellation is not replaced by the fallback.
   - **Cache:** SubQ's scores are cached under `judge = 'subq'` and SubQ's model. A cached JEV or LLM score for the same instruction and chunk is not a hit for SubQ, and the other way round. LLM answers given as a fallback are not cached.
   - **`judgeAll`:** `JUDGE_CONCURRENCY`, `JUDGE_TIMEOUT_MS` (as SubQ's per-call timeout), `JUDGE_CHUNK_TIMEOUT_MS` and `JUDGE_TOTAL_TIMEOUT_MS` apply as they do for `jev`.
2. **`QUERY_TRANSLATOR_IMPL=subq` selects tags through the SubQ client.** Tests with a faked SubQ API prove each of these:
   - **Algorithm:** the same as `jev`. A `choice` question picks the areas (at most 3). Then `noul` questions score the tags of those areas. Tags at or above `QUERY_TRANSLATOR_THRESHOLD` are kept, highest first, at most 8, and the area scores and every scored tag are returned for the UI.
   - **The 16-question limit:** with an area of more than 16 tags (e.g. 30), no request holds more than 16 questions and every tag of the area is scored exactly once.
   - **Failure:** when one call fails, the calls in flight are cancelled and the error is thrown, as with `jev`.
   - **Labels:** the translator's report label (`translatorLabel`) is `subq <model>`.
3. **Configuration.** `SUBQ_API_KEY`, `SUBQ_BASE_URL` (default `https://api.subq.ai/v1`), `SUBQ_MODEL` (default `subq-snap-preview`) and `SUBQ_TIMEOUT_MS` (default 30000) are read, validated and documented in `.env.example`.
   - With `RERANKER=subq` or `QUERY_TRANSLATOR_IMPL=subq` and no `SUBQ_API_KEY`, the server and `npm run query` refuse to start with a message naming `SUBQ_API_KEY` and what needs it. A config test proves it.
   - An invalid `SUBQ_BASE_URL` or `SUBQ_TIMEOUT_MS` is rejected at startup. A test proves it.
4. **The JEV code still works through the shared client.** Every existing JEV test (client, judge, translator, config, fallback, probe arguments) passes. The tests change only where an import path or a renamed type forces it, and none of their assertions is weakened.
5. **Paid-call guard.** `subq:probe`, `eval:run` (every variant: the default run, `--reranker …`, `--sweep`) and `bench:compare` each print the following before their first SubQ call, whenever their configuration will call SubQ:
   - the number of SubQ calls at most;
   - the estimated input tokens at most;
   - the estimated cost in USD, at $0.05 per million input tokens, from one constant that cites the SubQ models page.

   They continue only on `--yes` or on `y`/`yes` typed at an interactive prompt. Anything else, including stdin not being a terminal, stops the run with exit code 1 before any SubQ call. At the end, each run prints the input tokens SubQ actually reported and their cost. Tests prove:
   - the estimate (calls and tokens) for a fixed query set and settings;
   - that without `--yes` on a non-terminal stdin, no SubQ request is made;
   - that with `--yes` the run proceeds;
   - that a configuration without SubQ (e.g. `RERANKER=minilm`, `QUERY_TRANSLATOR_IMPL=llm`) neither prompts nor prints an estimate.

6. **`npm run subq:probe`** measures the same three things as `jev:probe` against SubQ: latency over 10 sequential calls, the largest state accepted (doubling from 1,000 characters) and a burst of 20 concurrent calls.
   - It has been run against the real API after the owner confirmed the estimate.
   - The README's new "SubQ limits" section has the measured values and the date.
7. **The evaluation has SubQ in it.** `eval/report-<date>.md`, from runs after the owner confirmed each estimate, has:
   - a `tags+subq` mode in `eval:run`, next to `tags+jev` and `tags+llm`, with a threshold sweep and a recommended `JUDGE_THRESHOLD` for SubQ;
   - every eval mode's precision and recall reported for statutes (`documents.type = 'law'`) and rulings (`'ruling'`) separately, as well as together;
   - per judge mode, the number of queries where the judge approved no candidate, and SubQ's score distribution (the share of scores in each tenth from 0 to 1);
   - `eval:run -- --reranker subq,llm,minilm,bge` rows, with tags as the retriever;
   - translator comparison rows: the comparison run with `QUERY_TRANSLATOR_IMPL=llm` and with `subq`. Each row names its translator and has a new "translation ms median / p90" column;
   - a `bench:compare -- --runs 1` row with `RERANKER=subq`.
8. **Both default rules applied as written:**
   - `RERANKER` defaults to `subq` when SubQ's central F1 at its recommended threshold is at least the LLM judge's central F1 at its recommended threshold in the same `eval:run`, **and** SubQ's median rerank time is at most half the LLM judge's in the same `--reranker` comparison. Otherwise `llm` stays the default.
   - `QUERY_TRANSLATOR_IMPL` defaults to `subq` when, in the translator comparison, tag search with SubQ's tags has at least the recall over the candidates (R@cand before rerank) of tag search with the LLM's tags, **and** at most half the LLM translator's median translation time. Otherwise `llm` stays.
   - SubQ's default `JUDGE_THRESHOLD` is the sweep's recommended threshold, and its default `QUERY_TRANSLATOR_THRESHOLD` stays 0.5 unless the owner decides otherwise.
   - The report states the outcome of both rules with the numbers. The code defaults, `.env.example` and the README agree with that outcome.
9. **Documentation.**
   - The README describes `subq` in the reranker list, the judge section, query translation, the cost guard and "SubQ limits".
   - The README introduction and `CLAUDE.md` no longer say "until JEV can be used". They name the current default judge, and JEV is described as paused, not removed.
10. **Checks.** `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` pass, and `npm test` makes no network request.

## Tasks

- [x] Generalise `backend/src/jev/` into a System One client (`backend/src/systemone/`).
  - One `createSystemOneClient` takes a provider identity (`jev` | `subq`, used in log entries and error messages) and that provider's config.
  - `SystemOneError` replaces `JevError` with the same kinds plus `status`, and includes SubQ's `detail.error_type`/`message` when present. A 402 says the account is out of credits.
  - Keep per-provider config loaders: `loadJevConfig` unchanged, plus a new `loadSubqConfig`/`hasSubqKey`.
- [x] Rename the JEV judge and translator to provider-neutral ones (`createSystemOneJudge`, `createSystemOneQueryTranslator`). The translator splits each area's tag questions into calls of at most 16 (the SubQ limit). JEV gets the same split, which is harmless.
- [x] Generalise the fallback judge to `SystemOneError`. The judge config, factory and cache identity get `subq`, and `JudgeScore['judgedBy']` gets `'subq'`. Wherever `judgedBy` is counted or labelled (eval `answeredBy`, the report, the UI's source list), SubQ is handled.
- [x] Add a `subq` reranker entry (remote) to the registry, and `subq` to `QUERY_TRANSLATOR_IMPL`, the translator factory and `translatorLabel`.
- [x] Generalise `judge/probe.ts` to take the provider. `jev:probe` stays, and `subq:probe` is added in the backend and root `package.json`.
- [x] Add the cost guard module, which counts calls and estimates tokens from the texts it will send, and wire it into `subq:probe`, `eval:run` (default, `--reranker`, `--sweep`) and `bench:compare`. Parse `--yes` in their argument parsers, and print the actual usage at the end.
- [x] In eval: add the `tags+subq` mode (no key → the LLM answers, as for JEV, asked once when the judges are the same), statute/ruling split, the "no candidate approved" count and SubQ's score distribution. Add the translation time column and the translator name to the comparison rows.
- [x] Update `.env.example`, the README and `CLAUDE.md`.
- [x] Tests for all of the above, with faked SubQ responses.
- [x] After the owner has put `SUBQ_API_KEY` in `.env` and confirmed each estimate, run `subq:probe`, `eval:run`, the `--reranker` comparison, the translator comparison and `bench:compare`. Then apply the default rules and record the results.

## Decisions

- **One shared System One client (owner).** SubQ's Decisions API has JEV's request and answer shape, so JEV and SubQ share the client, the judge and the translator. Only the config (key, URL, model, timeout) and the provider name differ. This keeps the adapter thin, as the issue asks: the provider-specific part is the config and the error body.
- **`tags+subq` is added, `tags+jev` kept (owner).** JEV can be re-run on the same set later without code changes. Without a key, a mode's judgements are answered by the LLM, and the LLM is asked only once when several modes resolve to the same judge.
- **The cost guard covers the batch scripts only (owner).** These are `subq:probe`, `eval:run` in every variant and `bench:compare`. A single query in the UI or `npm run query` costs fractions of a cent and is not guarded. Claude also asks the owner once more, with the estimate, before any live SubQ run (owner, 2026-10-15).
- **Wait for the key in step 5 (owner).** Everything is built and tested against a faked API. Before the live runs, Claude stops, asks for `SUBQ_API_KEY` in `.env` and the cost confirmation, and runs them before the PR is opened.
- **The estimate is an upper bound.** It ignores judge cache hits and counts every candidate as judged, at `MAX_CANDIDATES` (or `RETRIEVE_CANDIDATES` for the retrievers that use it) per query. Translation is 1 + 3 × ⌈tags in the area / 16⌉ calls per query, with the largest areas assumed. Tokens are estimated as characters / 3, rounded up, since SubQ's tokenizer is not published and Swedish text tokenizes worse than English. The actual usage SubQ reports is printed afterwards.
- **No `criteria` on the judge's `noul` question.** All judges get the same question, `relevanceQuestion`, so the comparison is fair and the cache key, which is built from the question, stays the same across judges.
- **SubQ's default `JUDGE_THRESHOLD` starts at 0.5,** like JEV's, and is replaced by the sweep's recommendation (criterion 8).
- **The 16-question split applies to JEV as well.** One code path is simpler than a per-provider limit. JEV's docs give no limit, and smaller calls are harmless.
- **The judge timeout comes from the judge settings.** `JUDGE_TIMEOUT_MS` replaces `SUBQ_TIMEOUT_MS` for the judge, as it replaces `JEV_TIMEOUT_MS` for JEV, so both judges get the same per-call budget.
- **Translation time is added to the comparison rows.** The translator rule needs a translation time from the same run as the recall, and today's comparison does not measure it.
- **Statute/ruling split from `documents.type`.** It takes `law` and `ruling` from the database, where they already exist. Precision and recall per type count only the returned and relevant chunks of that type.

- **Settled while implementing:**
  - **One `systemOne` field.** Both the judge config and the translator config carry the model's settings in one `systemOne` field (`impl` names the provider). The JEV config tests changed only in that field's name and in the shared loader's signature (`loadSystemOneConfig(env, provider, …)`), with no assertion weakened.
  - **Messages and logs keep their wording.** They are worded per provider (`JEV call failed`, `SubQ call failed`, `SubQ failed, judging with the LLM instead`), so the existing JEV assertions are unchanged.
  - **Where `--yes` is read.** The eval CLI takes `--yes` off the arguments before the run, comparison, sweep and bench parsers see them, and `probe.ts` takes it after the provider (`subq:probe -- --yes`). The guard runs before any reranker or translator is built, so a stopped run cannot have called SubQ.
  - **Actual usage from the logs.** The usage printed at the end is counted from the System One client's `SubQ call` log entries (`meterSubqUsage`), so no factory needs a new parameter.
  - **A new comparison heading.** The comparison table's new columns (`translator`, `translation ms median / p90`) come with a new heading, `## Retriever and reranker comparison, graded, with translation`, so the same-day appends never mix column sets. E7-4 did the same.
  - **The no-key fallback shares the LLM.** When `tags+subq` (or `tags+jev`) has no key, it uses the `llm` reranker. The LLM is asked once, under the first mode that uses it.
  - **Score bands for every judge mode.** The distribution and the "none approved" count are reported for every judge mode, not only SubQ's, since the data is already there.

- **Clean code (findings not applied):**
  - **Eval judges in parallel.** `eval:run` still asks its judges one after another, as before E9-1. Running SubQ and the LLM at once would stack two `JUDGE_CONCURRENCY` pools on the Claude Code subscription.
  - **The guard stays SubQ-only.** The spec scopes the paid-call guard to SubQ, and JEV is paused. Making it per provider waits for a second paid provider.
  - **Usage stays metered from the client's log entries.** A typed `onUsage` hook would have to be threaded through every factory, and a test pins the meter to the client's entries.
  - **No call budget enforced at run time.** The estimate is an upper bound shown before the run; enforcing it as a budget is new behaviour beyond the spec.

- **Code review (findings fixed):**
  - The comparison's estimate counts SubQ only when it has a key; without one, the comparison skips the `subq` reranker.
  - The sweep's estimate uses the sweep's own reranker choice (`sweepRerankerName`).
  - "None approved" counts only queries with judged candidates.
  - P@K per document type is taken over the list's real top K.
  - The translation estimate counts the most calls and the most characters separately, so both stay upper bounds.
  - The actual SubQ usage is printed in a `finally`, after a failed run too.
  - The estimate helpers moved from `systemone/` to `eval/subq-estimate.ts`, so `systemone/` no longer imports `query/`.
  - `SystemOneError` carries its provider, so the fallback judge names the failed model without a second argument.
- **Code review (findings not changed):**
  - **The estimate is not derived from the built setups.** Building them loads the local models and vectors, which the guard should not wait for. Instead, the two selections that drifted now share code or mirror the setup exactly: the sweep's reranker, and the comparison's skip without a key.
  - **No end-to-end test of the CLIs.** The eval and probe CLIs run at import time. Each command calls the guard before it builds any reranker, translator or client, and the guard's refusal is tested (`confirmSubqRun`, `confirmPaidRun`). A test that drives the CLI would first need the commands split out of the script.
  - **Failed SubQ calls are not counted.** The meter counts only the calls SubQ answered, since only those report billed tokens.

- **Migration `0008_judge_cache_subq` (found while verifying).** `judge_cache.judge` had a CHECK that allowed only `jev` and `llm`, so SubQ's scores were silently never cached: the write failed and was logged. The SubQ cache test found it. The migration rebuilds the table with `subq` allowed and keeps its rows, and an existing database needs `npm run db:migrate` once.

- **Live runs (2026-10-15, after the owner confirmed about 0.09 USD).** They ran as `subq:probe`, `eval:run`, `eval:run -- --reranker subq,llm,minilm,bge --retriever tags`, the same with `QUERY_TRANSLATOR_IMPL=subq --reranker minilm`, and `bench:compare -- --runs 1` with `RERANKER=subq`. Together they cost 0.047 USD. The LLM roles ran on the subscription, with `ANTHROPIC_API_KEY` overridden by an invalid key.
- **The default rules.** Neither rule holds, so `RERANKER` and `QUERY_TRANSLATOR_IMPL` stay `llm`.
  - The judge: SubQ's central F1 is 0.330 against the LLM's 0.371, although SubQ is 20 times faster.
  - The translator: SubQ's central R@cand is 0.332 against the LLM's 0.399, although SubQ is 7 times faster.
  - SubQ's default `JUDGE_THRESHOLD` is now 0.6, the sweep's recommendation.
- **Two characters per token in the estimate.** The translator comparison used 89,401 tokens against an estimate of at most 82,127 at 3 characters per token. The short tag questions came to about 2.8 characters per token, while chunks came to 3.7. The estimate now counts 2 characters per token, so it stays an upper bound.

## Open Questions

- None.
