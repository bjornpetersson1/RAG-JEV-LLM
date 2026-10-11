# RAG-JEV-LLM

Legal RAG proof of concept: tag-based search and the JEV judge model find relevant Swedish laws and rulings, and an LLM drafts employment agreements and NDAs from them.

## Prerequisites

- Node.js 24 LTS (see `.nvmrc`); npm ships with it.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY, or LLM_PROVIDER=fake to run without a key
npm run dev
```

`npm run dev` starts the backend on http://localhost:3000 and the frontend on http://localhost:5173. The frontend reaches the backend through the Vite dev proxy under `/api`, e.g. `/api/health`.

The backend needs a `.env`: it validates the LLM settings at startup and exits with a list of what is missing or invalid. Either set `ANTHROPIC_API_KEY`, or set `LLM_PROVIDER=fake` to run without a key (deterministic fake answers, no network).

## Database

SQLite through Node's built-in `node:sqlite`. The schema lives in numbered SQL files in `backend/migrations/`.

```bash
npm run db:migrate   # create the database or apply new migrations (safe to re-run)
npm run db:reset     # delete the database file and migrate from scratch
```

The file is `data/rag.db` by default, or `DATABASE_PATH` from `.env` (relative paths resolve from the repo root). `data/` is git-ignored.

## Data sources

The POC uses a fixed selection of 11 Swedish laws and 50 court rulings (45 from the Labour Court, AD, and 5 from the Supreme Court, HD) around employment, contracts and confidentiality. The list is committed in `sources/selection.json`; the documents themselves are fetched on demand.

```bash
npm run data:fetch            # download what is missing into data/raw/ (well under a minute)
npm run data:fetch -- --force # download everything again
```

The raw files are stored unchanged under `data/raw/laws/` and `data/raw/rulings/`, which are git-ignored, together with `data/raw/manifest.json`. The manifest lists every fetched document with its identifier, source URL, fetch time and file. A document that fails is logged, the rest are still fetched, and the command exits non-zero at the end.

| Source                                                                                                                                                                       | Used for                | Format stored                                                                                                                     | Terms                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [SFST, Regeringskansliet's legal database](https://rkrattsbaser.gov.se/) (`https://rkrattsbaser.gov.se/sfst?bet=<SFS number>`)                                               | Laws, consolidated text | The HTML page, with the law text as plain preformatted text and header fields such as "Utfärdad" and "Ändring införd: t.o.m. SFS" | Statutes are public documents without copyright (1 kap. 9 § upphovsrättslagen, 1960:729)                                        |
| [Domstolsverket's case-law API](https://www.domstol.se/om-webbplatsen-och-digitala-kanaler/oppna-data/) (`https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar/<id>`) | Rulings from AD and HD  | The JSON record, with the full ruling as HTML in `innehall` plus reference and case numbers and the decision date                 | Published by Domstolsverket as open data; court decisions are public documents without copyright (1 kap. 9 § upphovsrättslagen) |

Riksdagen's open data API (`data.riksdagen.se`) was considered for laws but refused connections when the sources were chosen.

### Importing laws

```bash
npm run data:import:laws   # parse data/raw/laws/ into the documents table (safe to re-run)
```

The import applies any pending migrations, then reads the laws listed in the manifest and stores each one with its title, identifier (`SFS 1982:80`), issue date, the last amendment included (`consolidated_through`) and a JSON structure tree in `documents.structure`. The tree holds chapters, sections and paragraphs (stycken), plus the transitional provisions. Amendment notes such as "Lag (2014:958)." are moved out of the text into the tree. Repealed sections, and section versions that are not in force on the day of the import, are left out. Re-running updates each law in place. A law that cannot be parsed is logged, and the command exits non-zero at the end.

### Importing rulings

```bash
npm run data:import:rulings   # parse data/raw/rulings/ into the documents table (safe to re-run)
```

Each ruling is stored with its court (`AD` or `HD`), its reference number as identifier (`AD 2024 nr 13`, `NJA 2015 s. 741`), its decision date and a title. The title is the API's name for the case, or the first sentence of its summary. The JSON structure tree in `documents.structure` holds the case numbers, all reference numbers, the summary, and the sections (Bakgrund, Yrkanden, Domskäl, Domslut, Skiljaktig mening …) with their sub-sections.

Only the deciding court's own text is imported, so every source reference points to AD's or HD's reasoning. For AD, the district court's judgment attached as BILAGA is left out. For HD, the lower courts and the reporting clerk's proposal are left out. A ruling whose sections cannot be recognised is imported as one section, "Domen", and flagged in the log. A record that cannot be read is logged, and the command exits non-zero at the end.

### Chunking

```bash
npm run data:chunk                              # chunk every imported document (safe to re-run)
npm run data:chunk -- --document "SFS 1982:80"  # chunk one document
```

Chunks follow the structure tree. A law gives one chunk per section and per transitional entry, and a ruling gives one per section and sub-section. A chunk is split further when it is longer than `CHUNK_MAX_CHARS` (default 2000 characters): first on paragraph boundaries, then on sentences, then on spaces. Pieces shorter than `CHUNK_MIN_CHARS` (default 200) are merged with a neighbour from the same section.

Each chunk stores:

- `source_ref`, the exact place in the source: `SFS 1982:80 7 §`, `SFS 2008:567 2 kap. 3 §`, `SFS 1982:80 7 § st. 2`, `AD 1994 nr 79, Domskäl, Tystnadsplikt` or `…, del 2/3`;
- `context`, the title and heading path, which later roles put in front of the text;
- `token_count`, an estimate (characters / 3.5).

Re-chunking matches chunks by `source_ref`. A chunk whose text and context are unchanged keeps its id and tags, even if its reference changed (for example `del 2/3` becoming `del 2/4`). A chunk whose text or context changed keeps its id but loses its tags, since tags are made from both, and the next `index:tag` tags it again. A chunk whose only change is its reference (for example `del 2/3` becoming `del 2/4`) keeps its tags. Renaming a title or heading therefore drops the tags of every chunk under it. Chunks that are no longer produced are deleted. The command prints chunks and min/median/max length per document, plus the totals.

## Tag vocabulary

Search is tag-based, so every chunk is tagged from a fixed vocabulary of Swedish tags, committed in `sources/tags.json`. Each tag has:

- a `slug` (lowercase `a–z`, digits and hyphens, e.g. `jamkning-36-avtl`);
- a Swedish `label`;
- a `description` that completes the question "Handlar texten om …?";
- an `area`: one of `anstallning`, `uppsagning`, `konkurrens`, `sekretess`, `lon`, `arbetstid`, `semester`, `diskriminering`, `avtalsratt`, `skadestand`.

`presets.employment` and `presets.nda` list the tags each document template starts from.

```bash
npm run index:vocabulary   # validate sources/tags.json and sync it into the tags table (safe to re-run)
```

The file must hold 100–300 tags, 5–30 per area, with unique slugs and labels, and 10–25 known slugs per preset. An invalid file is rejected with every problem listed, and the database is left unchanged. The sync matches tags by slug: new tags are inserted, changed ones updated, and tags removed from the file are deleted together with their chunk links. The command prints the vocabulary version, a hash of the tags' content. The tagger stores it with every chunk it tags and re-tags chunks with another version, so any edit to a tag means the whole corpus is tagged again on the next tagging run.

### Tagging

```bash
npm run index:tag                  # tag every chunk not yet tagged with the current model and vocabulary
npm run index:tag -- --limit 20    # tag at most 20 chunks, e.g. to check the cost on a sample first
npm run index:tag -- --force       # re-tag every chunk
```

The tagger role (`LLM_TAGGER_PROVIDER`/`LLM_TAGGER_MODEL`, `claude-haiku-5-5` in `.env.example`) picks 3–8 tags per chunk from the whole vocabulary. It reads the chunk's source reference, context and text. The vocabulary is sent as a cached system prompt, so after the first call it costs about a tenth of normal input. Slugs outside the vocabulary are discarded and logged. Case and surrounding whitespace in returned slugs are ignored. When fewer than 3 valid tags come back, the tagger asks once more and uses the second answer, topped up with the first answer's tags if it still has fewer than 3. More than 8 are cut to the first 8.

`index:tag` syncs the vocabulary first, then tags `TAGGER_CONCURRENCY` chunks at a time (default 4). Each chunk's tags are committed as soon as they arrive, so an interrupted run resumes where it stopped, and a re-run never creates duplicates. A chunk is skipped when it is already tagged with the current model and vocabulary version, even when it got no tags. A chunk whose tagging fails is logged and left for the next run, and the command then exits non-zero. `--force` takes untagged chunks first and then the oldest tagged ones, so repeated `--force --limit <n>` runs work through the corpus. Continue an interrupted `--force` run with `--force --limit <chunks left>`.

Every chunk is logged with its tags, discarded slugs, tokens and estimated cost. The run ends with a summary (its tokens and cost include calls made for chunks that then failed): chunks tagged, skipped and failed; discarded slugs; chunks outside 3–8; tokens by kind; estimated cost in USD in total and per chunk; and the time. The summary is also stored in the `tagging_runs` table. With Haiku, a full run over the roughly 2,100 chunks is estimated at well under 1 USD. `--limit` shows the real figure on a sample.

### Control report

```bash
npm run index:report   # print the control report without tagging (also printed after every index:tag)
```

The report checks the vocabulary and the tagging. `index:report` syncs the vocabulary first, as `index:tag` does. The report counts only chunks tagged with the latest run's model and the current vocabulary. It has three parts:

- **Summary:**
  - total chunks, how many are tagged and how many are not yet tagged or out of date;
  - tagged chunks with and without tags, and those with fewer than 3;
  - average tags per chunk with tags;
  - tags with no chunks, and broad tags;
  - from the latest run that tagged chunks: its time, model, vocabulary version, how many chunks it tagged, and their discarded out-of-vocabulary slugs and estimated cost.
- **Chunks per tag:** every tag, including those with 0 chunks, by number of chunks. A tag on more than `TAG_REPORT_BROAD_SHARE` (default 0.2) of the chunks with tags is marked broad.
- **Chunks without tags:** tagged chunks that got zero tags, with chunk id and source reference. The terminal shows the first 50.

Every report is also written in full to `reports/tagging-<UTC timestamp>.md`, which is git-ignored.

## Search index

When the backend starts it reads `chunk_tags` and builds the in-memory tag index that `TAG_INDEX` selects: by default the inverted index, one roaring bitmap of chunk ids per tag slug. It logs `Tag index built` with the implementation, the number of chunks and tags, the build time and the memory the index keeps. The `dev` and `start` scripts run Node with `--expose-gc`, so that figure is measured after garbage collection. The server does not create or migrate the database. If the database is missing, not migrated or has no tags, the server starts with an empty index and logs a warning naming the command to run. After `index:tag`, restart the server to pick up the new tags.

The index searches in three modes:

- AND: chunks with every tag.
- OR: chunks with any tag.
- Ranked OR: chunks with at least `minMatches` of the tags (default 1), with the most matching tags first, cut to `limit` (default 200). Candidate search uses it.

```bash
npm run bench:index   # time each mode over 100,000 synthetic chunks; fails if a roaring median is 5 ms or more
```

`TAG_INDEX` chooses the implementation the server builds:

- `roaring` (default): the inverted index.
- `bloom`: a bit-sliced bloom filter. Every chunk gets a signature of `BLOOM_BITS` bits (default 128), with `BLOOM_HASHES` bits set per tag (default 6). A tag's candidates are the chunks whose signature has all its bits. With `BLOOM_VERIFY=true` (the default), candidates are checked against the chunk's exact tags, so the results equal the inverted index's. With `false`, false positives remain. The startup log shows the settings and the theoretical false positive rate per tag test.

The benchmark generates the same seeded data every run (3–8 tags per chunk out of 183, with a few broad tags and many narrow ones). It runs 20 queries of 3 tags and 20 of 5 tags through 25 rounds against three indexes: the inverted index, the bloom filter with verification and the bloom filter without it. `BLOOM_BITS` and `BLOOM_HASHES` come from `.env`; `BLOOM_VERIFY` does not apply, since the bench runs both variants. For each index the benchmark prints the build time, the memory kept and the median and p95 time per mode. It then compares the unverified bloom filter's false positive rate per tag test with the theoretical one, and shows the share of wrong hits per mode. Only the inverted index must stay under 5 ms.

### Full-text fallback

Migration `0005_chunks_fts` adds an SQLite FTS5 index over each chunk's text, context and source reference, kept in step with `chunks` by triggers. Its tokenizer folds case but keeps å, ä and ö apart from a and o. The full-text query takes the words of the instruction and the chosen tags' labels, and drops common Swedish stop words and words shorter than 3 characters. Numbers must match exactly. Every other word becomes a prefix term, so inflected forms match: a word of 6 letters or more is first cut by up to 3 letters, keeping at least 5 (`uppsägningen` → `uppsägnin*`). The terms are joined with OR and ranked by bm25.

Candidate search (`createCandidateSearch`; the query flow in E5/E6 will call it, no HTTP route uses it yet) takes the tag index's ranked hits. With fewer than `MIN_TAG_CANDIDATES` (default 10), full-text hits not already found are appended, up to `MAX_CANDIDATES` (default 30). Each candidate records whether it came from `tag` or `fts`, and every search logs whether the fallback ran and how many candidates it added. The modes `fts` (full text only) and `tags` (tags only) are baselines for the evaluation.

## Query translation

A lawyer's instruction becomes vocabulary tags for the search (`translateQuery`; the query flow in E5/E6 will call it, the server so far only validates the settings). `QUERY_TRANSLATOR_IMPL` chooses how:

- `llm` (default): the query translator's LLM, with the whole vocabulary in a cached Swedish system prompt. It returns at most 8 slugs, and unknown or repeated ones are dropped.
- `jev`: TypeSafe's JEV model, with the instruction as the state.
  - A Choice question ("Vilket rättsområde handlar texten om?") scores the 10 areas.
  - The tags of the up to 3 most probable areas then get one Noul question each ("Handlar texten om <beskrivning>?"), one call per area, in parallel.
  - Tags scoring at least `QUERY_TRANSLATOR_THRESHOLD` (default 0.5) are kept, highest first, at most 8.
  - The result also carries every tag's score and the area scores, for the UI.
  - JEV needs `JEV_API_KEY`. `JEV_BASE_URL`, `JEV_MODEL` and `JEV_TIMEOUT_MS` are optional, and calls are not retried.

Choosing a template (`employment` or `nda`) adds its preset tags from `sources/tags.json`. A template without free text uses only its presets and calls no translator. With free text, the presets come first, followed by up to 8 translated tags that are not presets. Without free text and without a template, the result is no tags. Every translation reports the time it took and, when the translator gives it, the tokens it used.

## Judging

A judge decides whether a candidate chunk is relevant to the lawyer's instruction (`createJudge`; the query flow in E5/E6 will call it, the server so far only validates the settings). Both judges answer the same question about the same text: the chunk's source reference and text, asked "Är texten relevant för följande uppdrag: <instruktion>?". Each returns a score from 0 to 1, whether it reaches `JUDGE_THRESHOLD` (default 0.5), which judge answered, and the tokens used. `JUDGE_IMPL` chooses how:

- `jev-with-fallback` (default): JEV, with the chunk as the state and the question as one Noul question. When JEV fails (timeout, network or HTTP error, malformed answer), the judge's LLM answers instead, and a warning names the chunk and the cause. Without `JEV_API_KEY` the server logs a warning at startup and judges with the LLM.
- `jev`: JEV only; an error is thrown. Needs `JEV_API_KEY`.
- `llm`: the judge's LLM (`LLM_JUDGE_PROVIDER`/`LLM_JUDGE_MODEL`), asked for the probability that the answer is yes.

JEV gets `JUDGE_TIMEOUT_MS` (default 10000) per judgement and is not retried. Chunks are sent whole; one that JEV refuses as too large falls back like any other JEV error.

### Parallel judging and the judge cache

`judgeAll(instruction, chunks, deps, { cache })` judges a query's candidate chunks with the judge from `createJudging` (the judge, its cache identity and the threshold, from one config) in parallel, at most `JUDGE_CONCURRENCY` (default 8) calls at a time. A chunk whose judgement fails, or takes longer than `JUDGE_CHUNK_TIMEOUT_MS` (default 30000, fallback included), is `unknown`: it counts as not relevant, and a warning names it. When `JUDGE_TOTAL_TIMEOUT_MS` (default 60000) is reached, calls in flight are cancelled, every chunk not yet judged is `unknown`, and the judgements finished so far are returned.

Scores are cached in the `judge_cache` table:

- The key is the question asked about the instruction (trimmed, lower-cased, whitespace collapsed), the judge (JEV for `jev` and `jev-with-fallback`, else the LLM), its model and the chunk. A chunk whose text has changed is judged again.
- Only the primary judge's scores are stored, so an LLM fallback answer is asked for again next time.
- Relevance is decided against the current `JUDGE_THRESHOLD` when the score is read, so changing the threshold needs no new calls.
- `JUDGE_CACHE=off`, or `{ cache: false }` per call, skips the cache entirely, e.g. for timing measurements. Deleting the table's rows clears it.

The result has each chunk's status (`judged`, `cached` or `unknown`), score, relevance, judge and time, plus the total time, cache hits, judge calls, unknown chunks and tokens used.

### JEV limits

TypeSafe does not document JEV's maximum state size, pricing or rate limits. `npm run jev:probe` measures them against the real API with the judge's timeout `JUDGE_TIMEOUT_MS` (needs `JEV_API_KEY`; the calls are billed): latency over 10 sequential calls, the largest state accepted (doubling from 1,000 characters) and how a burst of 20 concurrent calls is answered.

**Observed so far: nothing.** The project has no JEV key yet, so the limits are not measured, and JEV's request shape is only checked against the documentation with faked responses. Run the probe once a key exists and record the results here.

## LLM configuration

Each LLM role (tagger, query translator, judge, generator) gets its provider and model from `.env`, so switching needs no code change:

- `LLM_PROVIDER` (`anthropic` or `fake`) and `LLM_MODEL` are the defaults for every role.
- `LLM_<ROLE>_PROVIDER` and `LLM_<ROLE>_MODEL` override them for one role, where `ROLE` is `TAGGER`, `QUERY_TRANSLATOR`, `JUDGE` or `GENERATOR`.
- `LLM_TIMEOUT_MS` and `LLM_MAX_RETRIES` tune the request timeout and retries.

Every real call is logged with role, model, latency, token usage and estimated cost. See `.env.example` for all keys.

## Checks

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

`npm run format` rewrites files with Prettier.
