# E3-2 · Tagger

- **Issue:** [#9](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/9)
- **Labels:** `E3 Tagging`
- **Phase:** 3. Tags and index
- **Depends on:** E1-2 (#2), E2-4 (#7), E3-1 (#8)
- **Status:** Approved

## Summary

At indexing time an LLM picks 3–8 tags from the E3-1 vocabulary for every chunk and `npm run index:tag` stores them in `chunk_tags`. The run is idempotent and resumable, discards tags outside the vocabulary, and logs tokens and estimated cost per chunk and per run. The vocabulary goes in a cached system prompt, so the long prompt is paid for in full only once per cache window.

## Goals

- The real tagger prompt (Swedish) behind the existing `Tagger` interface, with structured JSON output.
- Prompt caching in the Anthropic client, with cache tokens in the usage, the log and the cost estimate.
- Tagging state per chunk (model, vocabulary version, time), so re-runs skip what is already tagged with the current model and vocabulary.
- `npm run index:tag` with concurrency, resume, `--force`, a cost summary and a stored run record.

## Non-goals

- A JEV-based tagger. It fits the problem (chunk as state, one Noul question per tag), but the JEV adapter only arrives in E5-1 (#15). It can be added later as a second `Tagger` implementation chosen in `.env`; this is noted on #15.
- A keyword tagger without AI.
- A confidence per tag.
- Pre-filtering the vocabulary by area.
- The control report (E3-3) and the index (E4-1).
- Budget enforcement; cost is only logged, as in E1-2.

## Acceptance Criteria

1. **Tags outside the vocabulary are discarded.**
   - Slugs the model returns that are not in the vocabulary are dropped before storing, and each chunk's dropped slugs are logged with the chunk id and source reference. Duplicates in an answer are stored once.
   - A chunk with fewer than 3 valid tags gets exactly one more call, whose prompt says which slugs were invalid and that 3–8 are required. If it still has fewer than 3, the valid tags are stored and the shortfall is logged. A chunk with more than 8 valid tags keeps the first 8 in the model's order, and the cut is logged.
   - Tests with a fake LLM client cover: discarding unknown slugs, de-duplication, the retry when fewer than 3 remain (and no retry otherwise), accepting fewer than 3 after the retry, and cutting to 8.
2. **Re-running creates no duplicates.**
   - A chunk is skipped when its stored tagging model and vocabulary version equal the current ones, including a chunk that got zero tags. `--force` re-tags every chunk.
   - Re-tagging a chunk replaces its `chunk_tags` rows in one transaction with its tagging state, so there are never duplicate or mixed rows.
   - A chunk whose text or context changes when re-chunked (E2-4) loses its tags and its tagging state, so the next `index:tag` tags it again.
   - Each chunk is committed as soon as it is tagged, so an interrupted run resumes where it stopped. A chunk whose calls fail (after the client's retries) is logged, left untagged, and the run continues and exits non-zero at the end.
   - Tests with a fake Tagger on a temporary database cover: a first run tags all chunks, a second run skips all and leaves `chunk_tags` identical, a changed vocabulary version or model re-tags, `--force` re-tags without duplicates, a chunk with zero tags is skipped on the next run, a failing chunk does not stop the run, and a run interrupted halfway resumes with only the remaining chunks.
3. **Cost (tokens and estimated currency) is logged per run.**
   - Every tagged chunk is logged with its tokens (input, output, cache write, cache read) and estimated cost in USD.
   - The run ends with a summary: chunks tagged, skipped and failed, discarded slugs, chunks outside 3–8, total tokens by kind, estimated total cost in USD and average cost per tagged chunk, and the elapsed time.
   - The summary is stored as a row in a new `tagging_runs` table, so E3-3 can report it later without re-running.
   - The cost estimate prices cache writes and cache reads at Anthropic's published multipliers; a unit test checks the estimate for a usage with all four token kinds.
   - Tests cover the summary and the stored run row with the fake Tagger.
4. **Tests with the fake Tagger cover discard, dedup and re-run.**
   - Criteria 1–3's tests run without network access; `npm test` passes with no `ANTHROPIC_API_KEY`.

## Tasks

- [ ] `backend/migrations/0004_tagging.sql`: nullable `chunks.tagged_model`, `chunks.tagged_vocabulary_version`, `chunks.tagged_at`; table `tagging_runs` with the run summary fields.
- [ ] E2-4's chunk writer: clear the tagging state together with the tags when a chunk's text or context changes.
- [ ] LLM client: an optional cached prefix of the system prompt (`cache_control` on that system block); usage gains `cacheWriteTokens` and `cacheReadTokens`; the log entry and the price table account for them.
- [ ] `Tag` carries the slug, label and description; the tagger reports the token usage of its calls.
- [ ] The real tagger: a Swedish system prompt with instructions and the full vocabulary (slug, label, description, grouped by area) as the cached part; the chunk's source reference, context and text as the user content; a schema asking for an array of slugs; validation, the 3–8 rule and the single retry per criterion 1.
- [ ] Tagging run: sync the vocabulary (E3-1) first, select chunks to tag, tag them with a concurrency limit, commit per chunk, log per chunk, summarise and store the run.
- [ ] CLI `index:tag` with `--force` and `--limit <n>`; backend and root scripts.
- [ ] `.env.example`: `TAGGER_CONCURRENCY` and a tagger model default; README: the command, its options and the expected cost.
- [ ] Note on #15 that a JEV tagger can be added behind `Tagger`.
- [ ] Unit tests per acceptance criterion.

## Decisions

- **LLM tagger now, JEV later** (owner): JEV suits picking tags, but its adapter comes in E5-1 and its limits and cost are unknown; an LLM tagger keeps E3 and E4 unblocked, and the `Tagger` interface lets a JEV tagger replace it through `.env`.
- **Full vocabulary in every call, with prompt caching** (owner): the model sees every tag; the vocabulary is the cached system prefix, so after the first call it costs about 10 % of normal input. This adds caching to the E1-2 client. If the vocabulary prefix is below the model's minimum cacheable length, caching simply does not apply; the log shows it.
- **No confidence per tag** (owner): nothing downstream uses it; the index is binary.
- **One retry below 3, then accept; cut above 8** (owner): one extra call is cheap, and a chunk that still gets fewer than 3 is a signal for the vocabulary review that E3-3 shows.
- **Tagger model `claude-haiku-5-5` in `.env.example`** (owner chose the LLM tagger with this model): picking slugs from a list does not need a large model; a full run over about 2,100 chunks is estimated at around 1 USD. The model is set with `LLM_TAGGER_MODEL` as usual.
- **Tagging state on `chunks`** (default, as noted on this issue by E1-3): `chunk_tags` alone cannot tell a chunk with zero tags from an untagged one. A chunk is up to date when `tagged_model` and `tagged_vocabulary_version` match the current tagger model and the E3-1 vocabulary version. With the fake provider the model is recorded as `fake`.
- **`tagging_runs` table** (default): E3-3's report shows discarded slugs and cost without re-running; one row per run with time, model, vocabulary version and the summary counts.
- **One chunk per call** (default): the cached vocabulary makes per-chunk calls cheap, failures stay isolated, and resume is per chunk. "Batching" in the issue is met by the concurrency limit.
- **`TAGGER_CONCURRENCY`, default 4** (default), a positive integer validated like the other env settings.
- **The prompt includes source reference and context** (default): E2-4 stores context for this purpose.
- **USD only** (default): the price table is in USD; the issue's "estimated currency" is met by the USD estimate.
- **`index:tag` syncs the vocabulary first** (default), like `data:chunk` applies migrations, so the stored tags always match the file the version is computed from.
- **`--limit <n>`** (default): tags at most n chunks, so the cost of a full run can be checked on a sample first.

## Open Questions

- None.
