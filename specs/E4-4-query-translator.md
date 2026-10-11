# E4-4 · Query translator

- **Issue:** [#14](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/14)
- **Labels:** `E4 Index and search`
- **Phase:** 4. Judging and generation
- **Depends on:** E1-2 (#2), E3-1 (#8), E4-1 (#11), E5-1 (#15, not done — see Decisions)
- **Status:** Approved

## Summary

The lawyer's instruction becomes a set of vocabulary tags for the E4-1 index, through one of two implementations behind the `QueryTranslator` interface, chosen in `.env`: an LLM that returns slugs as JSON, and JEV, which picks areas with a Choice question and then scores each tag in those areas with a Noul question. Choosing a template adds its preset tags. The result carries the tags, the time taken and, for JEV, the score per tag for the UI (E7).

## Goals

- The real Swedish LLM prompt behind `QueryTranslator` (replacing E1-2's placeholder), returning up to 8 slugs.
- A minimal typed JEV REST client (Noul and Choice questions, API key, timeout, error mapping) in a `jev` module that E5-1 reuses.
- A JEV query translator: instruction as state, a Choice question for the areas, then one Noul question per tag ("Handlar texten om <description>?") in each chosen area, tags at or above the threshold selected.
- Template handling: `employment` and `nda` preset tags (E3-1) merged with the translated tags.
- `QUERY_TRANSLATOR_IMPL=llm|jev`, `QUERY_TRANSLATOR_THRESHOLD`, and the JEV connection settings in `.env`.
- A result with tags, their origin (preset or translated), elapsed time and, for JEV, per-tag and per-area scores.

## Non-goals

- The JEV judge, the LLM judge fallback and `JUDGE_*` settings (E5-1); E5-1 builds on this issue's client.
- A fallback from JEV to the LLM for query translation.
- Running the search or the query flow (E4-3, E5, E6); the translator only returns tags.
- The UI that shows the scores (E7-1) and the JEV-vs-LLM measurement (E5-4).
- Measuring JEV's limits, pricing or rate limits (E5-1).
- A live JEV call: `.env` has no JEV key; see Decisions.

## Acceptance Criteria

1. **A free-text instruction gives a valid tag set (only vocabulary slugs) with both implementations.**
   - LLM: the prompt (Swedish) gives the instruction and the vocabulary (slug, label, description by area); the answer's unknown and duplicate slugs are dropped, and at most 8 are kept in the model's order. Tests with a fake LLM client cover unknown, duplicate and more than 8 slugs.
   - JEV: the instruction is the state; a Choice question over the 10 areas (Swedish display names) picks up to 3 areas; one Noul question per tag in each chosen area is sent, one call per area, in parallel; tags scoring at or above the threshold are selected, highest score first, at most 8. Tests with a fake `fetch` check the request bodies (state, question types, wording), area selection, the threshold (a tag exactly at the threshold is selected) and the cap of 8.
   - Both return only slugs from the vocabulary; an empty result is allowed and is not an error.
   - JEV errors (HTTP error, timeout, malformed response) raise a typed error naming the cause; tests cover each with a fake `fetch`.
2. **A template selection gives a valid tag set with both implementations.**
   - A template alone (no free text) returns that template's preset tags without calling the LLM or JEV.
   - A template with free text returns the presets followed by the translated tags not already among them; each tag is marked `preset` or `translated`. The cap of 8 applies to the translated tags only.
   - An unknown template name is rejected. Tests cover both templates with both implementations (faked).
3. **The implementation is chosen in configuration.**
   - `QUERY_TRANSLATOR_IMPL` (`llm` | `jev`, default `llm`) selects the implementation; `llm` uses the E1-2 query-translator provider and model.
   - `QUERY_TRANSLATOR_THRESHOLD` (0–1, default 0.5), `JEV_API_KEY`, `JEV_BASE_URL` and `JEV_TIMEOUT_MS` are read and validated; `jev` without `JEV_API_KEY` fails at startup with a clear message, like `anthropic` without `ANTHROPIC_API_KEY`. All are documented in `.env.example`.
   - Tests show the factory building each implementation from env values alone, and each invalid value failing.
4. **Tests with fakes cover both implementations and template merging.**
   - Criteria 1–3's tests run without network access; `npm test` passes with no `ANTHROPIC_API_KEY` or `JEV_API_KEY`.
   - The result of every translation includes `elapsedMs`; the JEV result includes the score of every tag asked and the Choice scores of the areas.

## Tasks

- [ ] `backend/src/jev/`: config (`JEV_API_KEY`, `JEV_BASE_URL`, `JEV_TIMEOUT_MS`), a `fetch`-based client with `noul` and `choice` question types per the TypeSafe docs (docs.typesafe.ai), timeout and typed errors; injected `fetch` for tests.
- [ ] Extend `QueryTranslator` to take `{ instruction, template? }` and return `{ tags: { slug, origin, score? }[], areaScores?, elapsedMs, usage? }`; update the fake and its callers.
- [ ] Real Swedish LLM prompt for the query translator, with the vocabulary as a cached system prompt (as in E3-2) and the cap of 8.
- [ ] JEV query translator: Choice over areas, parallel Noul calls per chosen area, threshold, ordering and cap.
- [ ] Template presets from the E3-1 vocabulary file and the merge.
- [ ] Config: `QUERY_TRANSLATOR_IMPL`, `QUERY_TRANSLATOR_THRESHOLD`; factory wiring; server startup validation; `.env.example`; README.
- [ ] Tests per acceptance criterion.

## Decisions

- **Runs before E5-1** (owner, at epic start): E5-1 (#15) is still open. This issue builds the minimal JEV REST client E5-1 was to provide (owner), in a `jev` module E5-1 extends with the judge, fallback and limit measurements.
- **No live JEV verification** (consequence): `.env` has no `JEV_API_KEY`, so the request shape follows the TypeSafe documentation and is covered with a fake `fetch` only. The first live call (E5-1 or with a key) confirms it; differences found then are fixed in the client.
- **Separate threshold `QUERY_TRANSLATOR_THRESHOLD`, default 0.5** (owner): tag selection and chunk judging measure different things and are calibrated separately (E5-3).
- **At most 8 translated tags** (owner): as many as the tagger gives a chunk; with JEV the 8 highest scores at or above the threshold. Presets are not counted.
- **Choice first, then Noul per area** (owner): works whatever the per-call question limit is, and asks at most 3 × 30 Noul questions instead of 183. Up to 3 areas, taken in order of Choice score; if the API returns only a single chosen option, that one area is used.
- **Default `QUERY_TRANSLATOR_IMPL=llm`** (default): it works with the existing Anthropic key; JEV needs a key the project does not have yet.
- **A template alone uses only its presets** (default): the presets were chosen for the template (E3-1), and skipping the call saves time and cost. Free text adds translated tags.
- **Noul wording "Handlar texten om <description>?"** (default, from the issue and E3-1, whose descriptions are written to complete it); the Choice question is "Vilket rättsområde handlar texten om?" with the area display names as options.
- **The LLM prompt caches the vocabulary** (default), as the E3-2 tagger does.
- **`JEV_TIMEOUT_MS` default 30000, no retries** (default): a query translation sits on the user's critical path; E5-1 decides retries and fallback for judging.
- **Tags keep their slug as the key** (default), which is what the E4-1 index searches by.

## Open Questions

- None.
