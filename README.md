# RAG-JEV-LLM

Legal RAG proof of concept: tag search, followed by a judge (an LLM judge by default; SubQ optional; JEV paused), find relevant Swedish laws and rulings, and an LLM drafts employment agreements and NDAs from them. An initial idea to make generating rag-enginges faster but a vector-database is probably the right way to go. But the problem i'm trying to solve is not the gathering of correct context it is: what if the vector gives you to much context? -> Slim down the context for a faster output.

## Prerequisites

- Node.js 22.13 or later (see `.nvmrc`); npm ships with it. On Node 22, `node:sqlite` prints an `ExperimentalWarning` at start; it is harmless.

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

Candidate search (`createCandidateSearch`; the query flow and `eval:run` use it through `RETRIEVER=tags`; no HTTP route uses it yet) takes the tag index's ranked hits. With fewer than `MIN_TAG_CANDIDATES` (default 10), full-text hits not already found are appended, up to `MAX_CANDIDATES` (default 30, confirmed by the sweep in [Precision and candidate counts](#precision-and-candidate-counts-e7-4)). Each candidate records whether it came from `tag` or `fts`, and every search logs whether the fallback ran and how many candidates it added. The modes `fts` (full text only) and `tags` (tags only) are baselines for the evaluation.

## Retrieval

`RETRIEVER` picks where the reranker's candidates come from. Only `tags` is left (the default): tag search with the full-text fallback, as above, up to `MAX_CANDIDATES`.

```bash
npm run retrieve -- "konkurrensklausul efter anställningens slut" [--top-k 8]
```

`retrieve` prints the reranked top `RERANK_TOP_K` (or `--top-k`) chunks with their source, rerank score and place in the retriever's list, and the time for query translation, retrieval, reranking and in total. `npm run query` uses the same retriever before drafting.

**Removed local models (E10-1).** E8 ran bge-m3 hybrid retrieval (`RETRIEVER=bge|both`) and two local cross-encoders (`RERANKER=bge|minilm`) in Node through transformers.js; they took about 6 GB of downloads and are gone. Their settings are rejected at startup with a message naming them: `RETRIEVE_CANDIDATES`, `RRF_K`, `RRF_WEIGHT_*`, `RERANK_THRESHOLD_BGE`, `RERANK_THRESHOLD_MINILM`, `RERANKER_DTYPE`, `RERANKER_BATCH_SIZE`, `MODEL_CACHE_DIR`, `EMBEDDER`, `EMBEDDER_DTYPE`, `EMBEDDER_BATCH_SIZE`, and the values `RETRIEVER=bge|both` and `RERANKER=bge|minilm|qwen3`. Migration 9 drops their vectors (`chunk_embeddings`). Their measurements stay in the earlier reports in `eval/`. An embedding API for hybrid retrieval was considered and dropped, so as not to add another hosted service ([#111](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/111), not planned).

## Query translation

A lawyer's instruction becomes vocabulary tags for the search (`translateQuery`; the main flow always calls it, the reference RAG never). `QUERY_TRANSLATOR_IMPL` chooses how:

- `llm` (default): the query translator's LLM, with the whole vocabulary in a cached Swedish system prompt. It returns at most 8 slugs, and unknown or repeated ones are dropped.
- `subq`: Subquadratic's decision model SubQ Snap (E9-1), with the instruction as the state. Every call is billed.
  - A Choice question ("Vilket rättsområde handlar texten om?") scores the 10 areas.
  - The tags of the up to 3 most probable areas then get one Noul question each ("Handlar texten om <beskrivning>?"), at most 16 per call (SubQ's limit), all calls in parallel. When one call fails, the others are cancelled and the translation fails.
  - Tags scoring at least `QUERY_TRANSLATOR_THRESHOLD` (default 0.5) are kept, highest first, at most 8.
  - The result also carries every tag's score and the area scores, for the UI.
  - SubQ needs `SUBQ_API_KEY`. `SUBQ_BASE_URL`, `SUBQ_MODEL` and `SUBQ_TIMEOUT_MS` are optional, and calls are not retried.
- `jev`: the same with TypeSafe's JEV, through the same client (`JEV_API_KEY`, `JEV_BASE_URL`, `JEV_MODEL`, `JEV_TIMEOUT_MS`). Paused: JEV has never been called live, since TypeSafe's billing would not sell credits (#79).

JEV and SubQ answer the same "System One" API (`POST <base>/systemone` with a state and named typed questions), so one client (`backend/src/systemone/`) serves both; only the settings and the provider's name differ.

Choosing a template (`employment` or `nda`) adds its preset tags from `sources/tags.json`. A template without free text uses only its presets and calls no translator. With free text, the presets come first, followed by up to 8 translated tags that are not presets. Without free text and without a template, the result is no tags. Every translation reports the time it took and, when the translator gives it, the tokens it used.

## Reranking

The relevance step sits behind one `Reranker` interface (`backend/src/rerank/`). `RERANKER` in `.env` picks the implementation, and nothing else in the code branches on it. Every reranker is a judge (`llm`, `subq`, `jev`) that says yes or no per chunk against `JUDGE_THRESHOLD`, as the requirements' query flow has it, so a query with no relevant candidate gets no draft. The UI says "N bedömda som relevanta av M".

- `llm` (default; E7-7): the judge's LLM (`LLM_JUDGE_PROVIDER`/`LLM_JUDGE_MODEL`, Haiku in `.env.example`), asked for the probability that the answer is yes.
- `subq` (E9-1): SubQ, with the chunk as the state and the question as one Noul question. When a SubQ call fails (timeout, network or HTTP error, malformed answer), the judge's LLM answers that chunk instead, and a warning names the chunk and the cause, with SubQ's own error type and message; an HTTP 402 says SubQ is out of credits. Needs `SUBQ_API_KEY`; without it the server refuses to start. Every call is billed.
- `jev`: the same with JEV. Paused (#79); needs `JEV_API_KEY`.

`JUDGE_IMPL` was replaced by `RERANKER`; a `.env` that still sets it fails at startup. A reranker scores every candidate, drops those below the threshold and unknown chunks, and returns the best `RERANK_TOP_K` (default 8), best first. Every reranker returns the same shape: the chunk, a score from 0 to 1, the reranker and its model. Adding one is a new file with a `RerankerEntry` and one entry in `RERANKERS` (`backend/src/rerank/factory.ts`).

The `subq`, `jev` and `llm` rerankers ask the same question about the same text: the chunk's source reference and text, "Är texten relevant för följande uppdrag: <instruktion>?". A chunk is relevant when its score reaches `JUDGE_THRESHOLD`. Its default is per judge: 0.8 for `llm`, from E7-7's sweep with the Haiku judge (see [The judge step (E7-7)](#the-judge-step-e7-7)), 0.6 for `subq`, from E9-1's sweep (see [SubQ as the judge (E9-1)](#subq-as-the-judge-e9-1)), and 0.5 for `jev` until #79 measures JEV.

SubQ and JEV get `JUDGE_TIMEOUT_MS` (default 10000) per judgement and are not retried. Chunks are sent whole; one that is refused as too large falls back like any other error.

### Parallel judging and the judge cache

The `subq`, `jev` and `llm` rerankers judge through `judgeAll(instruction, chunks, deps, { cache })`. It judges a query's candidate chunks with the judge from `createJudging` (the judge, its cache identity and the threshold, from one config) in parallel, at most `JUDGE_CONCURRENCY` (default 8) calls at a time. A chunk whose judgement fails, or takes longer than `JUDGE_CHUNK_TIMEOUT_MS` (default 30000, fallback included), is `unknown`: it counts as not relevant, and a warning names it. When `JUDGE_TOTAL_TIMEOUT_MS` (default 60000) is reached, calls in flight are cancelled, every chunk not yet judged is `unknown`, and the judgements finished so far are returned.

Scores of the `subq`, `jev` and `llm` rerankers are cached in the `judge_cache` table:

- The key is the question asked about the instruction (trimmed, lower-cased, whitespace collapsed), the judge (SubQ for `subq`, JEV for `jev`, else the LLM), its model and the chunk. A chunk whose text has changed is judged again.
- Only the primary judge's scores are stored, so an LLM fallback answer is asked for again next time.
- Migration `0008_judge_cache_subq` (E9-1) lets the table hold SubQ's scores; run `npm run db:migrate` once on an existing database.
- Relevance is decided against the current `JUDGE_THRESHOLD` when the score is read, so changing the threshold needs no new calls.
- `JUDGE_CACHE=off`, or `{ cache: false }` per call, skips the cache entirely, e.g. for timing measurements. Deleting the table's rows clears it.

The result has each chunk's status (`judged`, `cached` or `unknown`), score, relevance, judge and time, plus the total time, cache hits, judge calls, unknown chunks and tokens used.

### Paid SubQ runs

Every SubQ call is billed ($0.05 per million input tokens for `subq-snap-preview`; output is free). The batch commands that would call SubQ (`subq:probe`, `eval:run` in every form and `bench:compare`) first print how many SubQ calls and input tokens the run makes at most and what that costs, and go on only when `y` is typed at the prompt or `--yes` is given; without a terminal and without `--yes` they stop before any call. The estimate is an upper bound: every candidate judged without the cache, every list full, a token per 2 characters (measured: about 3.7 for chunks and 2.8 for a translation's tag questions). At the end they print the input tokens SubQ actually reported and their cost. A configuration that does not call SubQ is not asked about. A single query (`npm run query`, the web UI) is not guarded: it costs a fraction of a cent.

```bash
npm run subq:probe                          # asks first
npm run eval:run -- --reranker subq,llm --yes
```

### SubQ limits

SubQ documents a context window of 384K tokens, 1–16 questions per call and the price; rate limits and latency are not documented. `npm run subq:probe` measures them as `jev:probe` does (below), with the cost guard above.

Measured on 2026-10-15 from the demo machine (`npm run subq:probe`, `subq-snap-preview`, timeout 10000 ms):

- **Latency:** median 316 ms, max 594 ms over 10 sequential calls with a 1,000-character state and one question.
- **State size:** 256,000 characters accepted, the probe's cap; nothing was refused. SubQ documents 384K tokens.
- **Burst:** 20 concurrent calls answered in 711 ms, none rate limited (HTTP 429) and no other errors.
- **Cost:** the 39 calls used 145,588 input tokens, 0.0073 USD, against an estimate of at most 183,857. That is about 3.7 characters per token for chunk-sized states. A translation's short tag questions came to about 2.8 (89,401 tokens for 131 calls), so the estimate counts 2.

### JEV limits

JEV is paused (#79). TypeSafe does not document JEV's maximum state size, pricing or rate limits. `npm run jev:probe` measures them against the real API with the judge's timeout `JUDGE_TIMEOUT_MS` (needs `JEV_API_KEY`; the calls are billed): latency over 10 sequential calls, the largest state accepted (doubling from 1,000 characters) and how a burst of 20 concurrent calls is answered.

**Observed so far: nothing.** The project has no JEV key yet, so the limits are not measured, and JEV's request shape is only checked against the documentation with faked responses. Run the probe once a key exists and record the results here.

## Judge measurements

### The judge step (E7-7)

The requirements' query flow has a judge that says yes or no per candidate, so `RERANKER=llm` is the default, with Haiku as the judge (`LLM_JUDGE_MODEL`). The LLM judge's default `JUDGE_THRESHOLD` is 0.8, the highest F1 on the central chunks in a sweep with that judge (`eval/report-2026-10-13.md`, "Judge threshold"). `eval:run` now sweeps the threshold against the central chunks and against all graded ones, keeps at most `RERANK_TOP_K` per query as the query flow does, and recommends by the central F1. A blank `LLM_JUDGE_MODEL` means Haiku, not `LLM_MODEL`.

Measured without drafts (`bench:compare -- --runs 1 --no-draft`, judge cache off), the main flow has its sources in 35 s with the judge (27 s of it judging, through the Claude Code CLI) and 11 s with a local ranker since removed (E10-1); the reference RAG in 50 ms. The judge gives the most relevant sources (precision 0.44 against 0.35 and 0.29) and can return none, in which case no draft is written. SubQ (E9-1) is the faster judge being measured; JEV (#79) is paused.

### SubQ as the judge (E9-1)

SubQ Snap was measured against the LLM judge on the evaluation set (`eval/report-2026-10-15.md`, "SubQ as the judge and query translator"):

- **Speed.** As the judge, SubQ reranks 30 candidates in 1.3 s per query against the LLM's 26.4 s, and the main flow has its sources in 1.5 s instead of about 27 s.
- **Ranking.** SubQ ranks better than every other reranker: central recall@8 is 0.322, against 0.276 for the LLM.
- **Central F1.** At its best threshold (0.6, now its default) SubQ reaches 0.330 on the central chunks, below the LLM's 0.371 at 0.8.
- **Default rules.** The rule fixed before the run needs SubQ's F1 to be at least the LLM's, so `RERANKER` stays `llm`. As the query translator SubQ is 7 times faster, but its tags find fewer relevant chunks (central R@cand 0.332 against 0.399), so `QUERY_TRANSLATOR_IMPL` stays `llm` too.
- **Cost.** All of E9-1's SubQ runs cost 0.047 USD.

## Evaluation

`eval/queries.yaml` holds 20 lawyer instructions (10 employment agreements, 10 NDAs, 6 with a template). Each lists the chunks relevant to it, by document identifier and stored source reference. Claude drafted the queries and marked the chunks from the candidates `eval:label` lists, and the owner reviews the file. Since E7-10 `eval:label` also lists the reference RAG's candidates (the `MAX_CANDIDATES` chunks BM25 ranks best for the instruction since E10-1; vector search before it), and marks each candidate with every search that found it (`tags`, `fts`, `reference`), so a chunk only the reference RAG finds gets labelled too.

```bash
npm run eval:label -- anst-01 [--chars 300]   # candidates for one query: tag search, full text, then the reference RAG's BM25
npm run eval:run                              # precision, recall and the threshold sweep
```

`eval:run` runs every query through five modes and prints precision and recall (macro averages over the queries):

- `tags`: tag-search candidates (E4-1);
- `tags+jev`: those candidates as approved by the `jev` reranker;
- `tags+subq`: the same, with the `subq` reranker (E9-1);
- `tags+llm`: the same, with the `llm` reranker;
- `fts`: full-text candidates only (E4-3).

The report also gives every mode's measures for statutes (`law`) and rulings (`ruling`) apart, counting only the returned and relevant chunks of that document type, over the queries with a relevant chunk of it; and per judge mode the number of queries where the judge approved no candidate and the share of its scores in each tenth from 0 to 1 (E9-1).

Here a reranker keeps every relevant candidate, not only `RERANK_TOP_K`, so the numbers stay comparable with the first run. For each judge mode, thresholds from 0.1 to 0.9 are applied to the judge's scores, and the threshold with the highest F1 is recommended. The judge cache is on, so the sweep and repeated runs cost no new calls. The full report, with one row per query, goes to `reports/eval-<timestamp>.md`.

Without `JEV_API_KEY` or `SUBQ_API_KEY`, `tags+jev` or `tags+subq` is answered by the `llm` reranker, and the report says so; judges that are the same are asked once. With `SUBQ_API_KEY`, the run asks first (see [Paid SubQ runs](#paid-subq-runs)). To run without the paid API, use the Claude Code provider. It starts the `claude` CLI without `ANTHROPIC_API_KEY`, so the calls go to your subscription even when `.env` has a key. A `claude` call takes several seconds, so give the judge more time than the defaults, which are sized for SubQ, JEV and the API:

```bash
LLM_PROVIDER=claude-code LLM_MODEL=claude-haiku-5-5 LLM_TIMEOUT_MS=120000 \
  JUDGE_CHUNK_TIMEOUT_MS=150000 JUDGE_TOTAL_TIMEOUT_MS=600000 npm run eval:run
```

The first run's report is kept in `eval/report-2026-10-11.md`. A query that fails, e.g. because the CLI keeps failing, is listed in the report and left out of the averages, and the command exits non-zero.

### Comparing rerankers

```bash
npm run eval:run -- --reranker subq,llm
```

With `--reranker`, `eval:run` compares rerankers instead (E8-5). Every query goes through tag search and, as a baseline, full-text search (`fts`), and each candidate list through each reranker, which keeps every relevant candidate. One row per retriever and reranker gives recall@5/@8/@10 and recall over all candidates, before rerank (the retriever's own order, reranker `none`) and after it, precision@5/@10 after rerank, and the median and p90 latency per query of the rerank and of retrieval. The tag search row also names the query translator and the translation's latency per query (E9-1), so two runs with `QUERY_TRANSLATOR_IMPL=llm` and `subq` compare the translators. The table is printed and appended to the table in that day's `eval/report-<date>.md`; every report has the same columns, so rows from different days can be put side by side (E10-1 dropped the `dtype` column). The command exits non-zero when queries failed.

- `tags` here is E5-3's tag search without the full-text fallback.
- A reranker that cannot run is a skipped row with the reason, e.g. `subq` without `SUBQ_API_KEY`; the others still run.
- A reranker whose scores came from the judge cache takes its latency from the queries without cache hits, or, with fewer than 5 of those, from a cache-off pass over the first 5 queries; its row says which.

### Switch reranker in three steps

1. Set `RERANKER=` in `.env`: `llm` (default), `subq` or `jev` (paused).
2. Fill in what it needs: `SUBQ_API_KEY` for `subq`, `JEV_API_KEY` for `jev`; the judge's LLM settings for `llm`.
3. Verify with `npm run retrieve -- "<question>"` (one question, the reranked chunks and their scores) or `npm run eval:run -- --reranker <name>` (the evaluation set).

Nothing else changes: the query flow and `eval:run` only know the `Reranker` interface.

### Precision and candidate counts (E7-4)

Every relevant chunk in `eval/queries.yaml` has a grade:

- `central`: the provision or a court's general statement of the rule the clause rests on.
- `related`: other parts of the same law or case, such as background, one case's facts or neighbouring sections.

Claude graded the 266 labels (131 central); the owner's review of them, and the JEV run with `JUDGE_THRESHOLD`, are [#79](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/79). `eval:run` reports every mode's precision, recall, F1 and P@5/P@10 against the central chunks and against all graded ones. The comparison (`--reranker`) gives each pair a row per grade, with P@5/P@10 also before rerank in the retriever's order.

```bash
npm run eval:run -- --sweep
```

`--sweep` tries 10, 20, 30, 40 and 50 candidates with top 5, 8, 10 and 12, for tag search (`MAX_CANDIDATES` = N) and the reranker `RERANKER` names (the LLM judge by default; uncached, it makes many calls, so run it on the subscription). Until E10-1 it also swept a hybrid retriever and defaulted to a local ranker. Each query's lists are reranked once together, without the cache, and each list keeps its chunks in that score order; since each chunk is scored on its own, that is what reranking the list alone gives. The rerank times are estimates from that one rerank. The table goes into that day's report, with the setting a rule picks per retriever: the highest central F1 among the settings whose central recall is at most 0.03 below the old default's, and on a tie within 0.01 the fewest candidates, and of those the highest central F1.

The first sweep (2026-10-13, with a local ranker since removed; in `eval/report-2026-10-13.md`) set the defaults:

- `MAX_CANDIDATES` stays 30: with top 8 it has the best central F1 with `tags` (0.221), and fewer candidates lose central recall.
- `RERANK_TOP_K` stays 8.

### Main flow vs reference RAG

```bash
npm run bench:compare [-- --runs 5] [--limit <n>] [--no-draft] [--yes]
```

`bench:compare` (E5-4) runs every evaluation query through the main flow (as `.env` configures it) and the [reference RAG](#reference-rag), `--runs` times each (default 5). Within a run the two flows take turns going first, and the judge cache is off, so an `llm`, `subq` or `jev` reranker is measured on every run. With `RERANKER=subq` or `QUERY_TRANSLATOR_IMPL=subq` it asks first (see [Paid SubQ runs](#paid-subq-runs)). One row per flow gives the median and p90 over every run of:

- total time;
- query translation (main flow only), and time to sources (E7-8): search plus rerank, without the translation; this is the measure the comparison is about, since the drafts' length weighs on the total;
- search time: retrieval and loading the chunks;
- rerank time, with the median number of candidates the rerank judged (`judged`) and the candidates it could not score over every run (`unknown`, a failed or timed-out call);
- generation time, also per output token (`ms/token`, one decimal) with the drafts' output tokens, so a longer draft does not read as a slower flow;
- LLM time: query translation, generation and the rerank;
- precision and recall of the chunks sent to the generator (each flow's approved chunks, those that fit the context limits when a draft is written), macro averages over the queries, averaged over the runs;
- source accuracy: valid references / all references (E6-3).

A judge can approve nothing, and then no draft is written, so the flows can write drafts for different queries. Generation, ms/token, output tokens and source accuracy are therefore computed only over the query and run pairs where both flows wrote a draft, and `without draft` counts each flow's pairs with none.

The table is printed and appended to the "Main flow vs BM25 reference RAG: the same judge" table (E10-1, without the embedding column; before it, "Main flow vs reference RAG: the same judge" from E7-9, "Main flow vs reference RAG: time to sources", and before E7-8, "Main flow vs reference RAG") in that day's `eval/report-<date>.md`. `--limit <n>` runs only the first n queries and `--no-draft` measures retrieval and rerank without generation. A query that fails in a run is listed, and that query and run is left out of both flows, so the rows are compared on the same samples (the `samples` column counts them); a flow with no measured sample shows `–`. The command then exits non-zero.

Every flow run is also written to the [run log](#run-log) with `source: "bench"` and the evaluation query and run, so the runs show under _Tidigare körningar_ in the UI (E7-12). The two flows of one query and run share a `runId`. A failed run is logged with its error.

The first full run (2026-10-12, in `eval/report-2026-10-12.md`, 84 of 100 query and run pairs after the subscription's session limit stopped some calls): the reference RAG, then with vector search, took a median 29.5 s against the main flow's 71.8 s with a local reranker since removed, almost all of the difference being that rerank (37.0 s); the main flow sent better chunks (precision 0.398 against 0.302, recall 0.254 against 0.208); source accuracy was about equal (0.917 and 0.914).

With the same LLM judge in both flows (E7-9, 2026-10-13, one run with drafts on Haiku, in `eval/report-2026-10-13.md`), both have their sources in about 26.5 s. The judge takes that long in both, and tag search beats the reference RAG's vector search (before E10-1) by only 53 ms (2 ms against 55 ms). Counting the 7.4 s translation into tags, the main flow has its sources 7.2 s later. It sends better chunks (precision 0.516 against 0.419, recall 0.279 against 0.204), with about the same source accuracy (0.973 and 0.954). The labels were made from tag and full-text candidates, which favours the main flow; #95 labels the chunks only vector search finds.

The full run (20 queries × 5 runs × 2 flows, each with a draft) takes about three hours, and a long run can reach the subscription's session limit: those calls fail and their query and run pairs are left out of both rows. To run it on the Claude Code subscription instead of the paid API:

```bash
LLM_PROVIDER=claude-code LLM_MODEL=claude-haiku-5-5 LLM_GENERATOR_MODEL=claude-sonnet-5-5 \
  npm run bench:compare
```

## Prompt templates

The generator drafts contracts from the Swedish prompt templates in [`prompts/`](prompts/): `employment.md` (employment agreement) and `nda.md` (NDA), one per template id. Each template fixes the required contract sections, the inline citation format `[K:<chunk-id>]`, the `[lön]`-style placeholders for details the instruction does not give, the fictional default parties and the not-legal-advice disclaimer. [`prompts/README.md`](prompts/README.md) documents the file structure, the slots and the citation format.

## Query and draft

`npm run query` runs the whole query flow in the terminal: query translation, retrieval with the configured `RETRIEVER` (`tags`, tag search with the full-text fallback), reranking and the draft.

```bash
npm run query -- "Anställningsavtal för en säljare med sex månaders provanställning" --template employment
npm run query -- "<instruction>" --template nda --max-chunks 30 --max-context-chars 90000
```

`--template` (`employment` or `nda`) selects both the template's preset tags and the prompt template. The command prints:

- the query tags;
- the number of candidates, approved chunks and chunks sent to the generator;
- the draft;
- the sources it cites and the sources it does not cite;
- the post-check (E6-3): the source accuracy (the share of `[K:]` citations and free-text legal references such as "7 § LAS" or "AD 2019 nr 35" that match a chunk sent to the generator) and every flagged reference with its position in the draft;
- the time in ms and the tokens for each step.

The reranker keeps at most `RERANK_TOP_K` (default 8) approved chunks. They go to the generator best first, up to `GENERATOR_MAX_CHUNKS` (default 20) and `GENERATOR_MAX_CONTEXT_CHARS` (default 60 000). When the limits leave chunks out, the output says how many and prints the same command with `--max-chunks` and `--max-context-chars` large enough to include them all. Running it again repeats the whole flow. Judge scores that are cached (from SubQ with `RERANKER=subq`, JEV with `RERANKER=jev`, or the LLM with `RERANKER=llm`) are reused, but LLM answers standing in for a failed SubQ or JEV call are not cached, and an LLM query translator may pick other tags, so the rerun can find somewhat different chunks. When the reranker approves nothing, or no approved chunk fits the limits, no draft is written.

Example drafts for both templates, made with the Claude Code provider, are in [`prompts/examples/`](prompts/examples/). To run on the subscription instead of the paid API, use the settings they were made with (`RERANKER=llm`, called `JUDGE_IMPL=llm` then, reuses the evaluation's cached LLM scores while there is no JEV key):

```bash
LLM_PROVIDER=claude-code LLM_MODEL=claude-haiku-5-5 LLM_GENERATOR_MODEL=claude-sonnet-5-5 \
  RERANKER=llm JUDGE_CHUNK_TIMEOUT_MS=150000 JUDGE_TOTAL_TIMEOUT_MS=900000 \
  npm run query -- "Sekretessavtal för en konsult som får tillgång till kunddata och affärsplaner." --template nda
```

The token line shows the normally billed input plus cache writes and reads (e.g. `in 2 + cache 41230`), since with the Claude Code provider most of the input can be cache traffic.

## Reference RAG

The "100 % LLM" counterpart of the main flow, to measure it against (E5-4, E7-9): it does the same steps, but finds its candidates without tags. Since E10-1 it takes the `MAX_CANDIDATES` (default 30) chunks SQLite FTS5 ranks best by BM25 for the instruction's words and numbers, with law abbreviations replaced by their SFS number so `7 § LAS` matches `SFS 1982:80 7 §` (until E10-1 it searched with local vectors). The LLM judge then scores them as in the main flow, at `JUDGE_THRESHOLD`, keeping at most `RERANK_TOP_K`, and the same generator, template, context limits and post-check write and check the draft. The reference always judges with the LLM, whatever `RERANKER` the main flow uses; with `RERANKER=llm` both flows share one judge. When the judge approves nothing, no draft is written. There is no query translation.

```bash
npm run query -- "Anställningsavtal för en säljare med sex månaders provanställning" --template employment --reference
```

The output has the main flow's format, without tags, and the time for search, judging, generation and in total. `npm run bench:compare` compares the two flows on the evaluation queries (see [Main flow vs reference RAG](#main-flow-vs-reference-rag)).

## Web UI

`npm run dev` starts the backend and the React UI (Vite proxies `/api/*` to the backend). The form (E7-1) has a required contract type, _Anställningsavtal_ (`employment`) or _Sekretessavtal_ (`nda`), an optional free-text instruction, and an option to also run the [reference RAG](#reference-rag). Both paths run the same flow:

- **Template alone.** The template's preset tags are the query's tags. The search, rerank and generator are asked the template's default instruction, the contract itself ("Anställningsavtal" / "Sekretessavtal"), and the UI says that this text was used. Generic words such as "upprätta" are left out because they would match unrelated chunks in full-text search.
- **Template with free text.** The translated tags are added to the presets (see [Query translation](#query-translation)).

As each step finishes, the UI shows the tags (marked _mall_ for a preset, _översatt_ for a translated tag), the number of candidates and how many of them came from the full-text fallback, the number the reranker approved, and finally the draft. With the reference option, the reference RAG runs after the main flow, never at the same time, so neither distorts the other's timings. The UI texts are in Swedish, like the sources and drafts.

When a flow is done, the result view (E7-2) shows its draft and sources:

- **Draft.** The draft is rendered as Markdown (with `react-markdown`, raw HTML off), below a reminder that it is source material, not legal advice. Every `[K:<id>]` citation (each id of a group such as `[K:12, K:40]`) and every free-text reference the post-check matched to a sent chunk, such as "7 § LAS", is a link. Clicking it opens that chunk's text in the source list, scrolls to it and highlights it. A reference the post-check flagged is red with the reason as a tooltip. The source accuracy and the number of flags are shown above the draft, and "Kopiera utkastet" copies the Markdown as written.
- **Sources.** The sources come in three groups: the sources the draft cites, those sent but not cited, and a collapsed list of the candidates that were not sent, i.e. turned down by the reranker or left out by the context limits. Each source shows its `source_ref`, the document's title, the reranker's score and name, where the candidate came from (_tagg_, _fritext_, or _BM25_ for the reference RAG), its text when opened, and a link to the original source when the document has a `source_url`.

The result carries what this needs: `sources` lists every candidate with its document, origin, score and what became of it (`status`: `cited`, `sent`, `left-out` or `turned-down`), and the post-check returns its `matches` next to its `flags`.

Above the results, the timing panel (E7-3) shows each step's time and the total for both flows, side by side, with a bar per flow on one shared scale. The steps are query translation, search, rerank (with the average per candidate the reranker scored, and the judge cache hits), time to sources (E7-8: search plus rerank, without the translation), generation (with the draft's output tokens and ms per token) and the total. A step appears as soon as it finishes, a step still running shows `…`, and a step the flow does not run shows `–`. The UI keeps the judge cache on, and the reference runs after the main flow on the same question, so a chunk both flows found is a cache hit for the reference: its judge time and time to sources can come out lower than a fresh run's. The panel's comparison is therefore a demo; `bench:compare`, which runs with the cache off, is the measured result. When both flows are done, the panel says how much sooner or later the main flow had its sources, once without and once with the query translation (whose time it names), and then how much faster or slower it was in total. A line per flow names its configuration: retriever, tag index, query translator, reranker with model, `RERANK_TOP_K` and generator. The reference RAG option is on by default. Without it, the panel says the reference was not run.

### Info texts and earlier runs

The UI explains its numbers in plain Swedish, written for a lawyer (E7-11). There are three kinds of text:

- An introduction above the form says what the comparison is about, as `.env` configures it (E7-14):
  - With `RERANKER=llm`, both flows use the same LLM judge and generator, so the comparison is tags against BM25.
  - With another `RERANKER` (e.g. `subq`), it is the POC's goal: tag search plus a small judge against a regular RAG with the LLM judge. The introduction names both judges ("en liten domarmodell (SubQ)", "AI-domaren (LLM)") and says the difference is both how the sources are found and how they are judged.
  - Before the configuration has loaded, or without a backend, it makes no claim about the judges.
- Each section has one always-visible sentence: the timing panel, the draft's post-check and the source list.
- Each measure has an (i) button that opens what it measures, why, and how to read it, in place. The measures are each timing row and its details, the configuration, the source accuracy and flags, a source's score and origin, and the source groups.

The comparison under the timing panel also reads the result in words. It names what the gap in time to sources consists of (the translation, the search and the judge) and which flow knew its sources first. It ends with the notice that the UI's numbers are a demo and that `npm run bench:compare` is the measurement. With `JUDGE_CACHE=on` it adds that judgements from an earlier run of the same instruction can be reused. When both flows also use the same judge, it says instead that judge answers are saved and the reference RAG can reuse the main flow's judgements. The texts live in `frontend/src/explanations.ts`.

The introduction and the notice read `GET /api/config` (`/config` on the backend). It returns each flow's judge, as its `RERANKER` value, and whether the judge cache is on:

```json
{ "judges": { "main": { "name": "subq" }, "reference": { "name": "llm" } }, "judgeCache": true }
```

It is read from `.env` at startup without building a flow, so it answers also without a database.

The tab _Tidigare körningar_ (`#korningar`) lists every run in the [run log](#run-log), newest first, grouped per request. Each request shows where it was started ("UI", "Terminal" for `npm run query` or "Benchmark" for `bench:compare`), its time, contract type and instruction, and each flow's time to sources and total, or its error. It filters by contract type, flow and source, 20 requests per page. Opening a request shows its source (for a benchmark run with its evaluation query and run, e.g. "Benchmark (q03, körning 2 av 5)"), timing panel, counts and source accuracy, with the same info texts. The run log keeps no drafts or sources, so an earlier run shows neither. A field an older entry lacks shows `–`.

The list comes from `GET /api/runs` (`/runs` on the backend):

```bash
curl 'http://localhost:3000/runs?template=nda&flow=reference&source=bench&page=2'
```

- `template` (`employment` or `nda`), `flow` (`main` or `reference`, a request with that flow) and `source` (`api`, `cli` or `bench`) are optional filters.
- `page` starts at 1.
- The answer has `requests` (each with `runId`, `timestamp` and its `flows`' log entries, the main flow first), `total`, `page` and `pageSize`.
- A line in the log that is not JSON, or lacks `runId`, `timestamp`, `flow`, `template` or `timings`, is skipped. A missing log gives an empty list.
- A request's `timestamp` is when its first flow started; the list is ordered by it.

### Run log

Every run of a flow, from the UI, `npm run query` or `bench:compare`, is appended as one JSON line to `logs/runs.jsonl` (git-ignored; the folder is created when missing):

```json
{
  "timestamp": "2026-10-13T12:00:00.000Z",
  "runId": "…",
  "source": "api",
  "flow": "main",
  "template": "employment",
  "instruction": "…",
  "configuration": {
    "retriever": "tags",
    "tagIndex": "roaring",
    "translator": "…",
    "reranker": "llm claude-haiku-5-5",
    "generator": "…",
    "topK": 8
  },
  "timings": {
    "translationMs": 800,
    "searchMs": 12,
    "judgingMs": 2900,
    "generationMs": 25000,
    "totalMs": 28712
  },
  "counts": { "tags": 12, "candidates": 30, "fallback": 0, "approved": 8, "sent": 8, "cited": 7 },
  "judging": { "relevant": 9, "cacheHits": 0, "judgeCalls": 30, "unknown": 0 },
  "sourceAccuracy": 0.92
}
```

The fields:

- `runId` is shared by the flows of one request.
- `source` is where the run was started: `api` (the UI), `cli` (`npm run query`) or `bench` (`bench:compare`, E7-12).
- `bench` is only on a `bench:compare` entry: `{ "queryId": "q03", "run": 2, "runs": 5 }`, the evaluation query and the run (from 1) of how many.
- `instruction` is the free text as written; with a template alone it is empty, and `defaultInstruction` holds the instruction the flow used instead.
- `counts` holds the query's tags and the candidates, those from the full-text fallback, those approved, those sent to the generator and those the draft cites.
- `judging` holds the rerank's relevant chunks, cache hits, scoring calls and the chunks it could not score; it is absent for a flow without a rerank step.
- A run that fails has an `error` and the timings of the steps it finished, and no counts.
- A log line that cannot be written is a warning; the query, or the benchmark, goes on.

### `POST /query`

The body is `{ "template": "employment" | "nda", "instruction"?: string, "reference"?: boolean }`. An invalid body answers 400 with `{ "error": "…" }`. A query sent while another is running answers 409, because the flow uses every CPU core. Otherwise the answer is `application/x-ndjson`, one JSON event per line:

- `{ "type": "start", "flow": "main" | "reference", "steps": [...], "configuration": {...} }` when a flow begins, with its configuration and the steps it will run in order, e.g. `["search", "rerank", "generation"]` for the reference RAG. The UI shows the next of these as running.
- `{ "type": "step", "flow", "step": "translation" | "search" | "rerank" | "generation", "timings", … }` when a step finishes: the translation's `tags`, the search's `candidates` and `fallback`, the rerank's `approved` and `relevant`, and each step's part of the result's `timings` (`translationMs`, `searchMs`, `judgingMs`, `generationMs`). A flow without a step, e.g. the reference RAG without translation, sends no event for it.
- `{ "type": "result", "flow", "result" }` with the flow's whole result: tags, counts, approved chunks, draft with post-check, timings and tokens.
- `{ "type": "skipped", "flow", "reason" }` for a flow that cannot be built. The stream goes on, and the panel says why the flow was not run.
- `{ "type": "error", "flow", "message" }` when a flow fails while running, which ends the stream.
- `{ "type": "done" }` after the last flow.

The server builds both flows at startup on the existing database, sharing the server's tag index, before it listens. Without a database, or with migrations pending, the server still starts, without this route, and logs a warning naming the command to run; it never creates or migrates the database. If a flow cannot be built, the server exits with the reason; a removed setting stops it at startup, naming the setting (see [Retrieval](#retrieval)). If the client goes away, e.g. a closed tab, the query stops before its next step, and the server takes new queries once the current step is done.

## LLM configuration

Each LLM role (tagger, query translator, judge, generator) gets its provider and model from `.env`, so switching needs no code change:

- `LLM_PROVIDER` (`anthropic`, `claude-code` or `fake`) and `LLM_MODEL` are the defaults for every role.
  - `claude-code` runs the local `claude` CLI in print mode (no tools, structured JSON output) on your Claude Code subscription, so it needs no `ANTHROPIC_API_KEY`. A call takes a few seconds, so it suits evaluation runs, not timing.
- `LLM_<ROLE>_PROVIDER` and `LLM_<ROLE>_MODEL` override them for one role, where `ROLE` is `TAGGER`, `QUERY_TRANSLATOR`, `JUDGE` or `GENERATOR`.
- `LLM_TIMEOUT_MS` and `LLM_MAX_RETRIES` tune the request timeout and retries.

Every real call is logged with role, model, latency, token usage and estimated cost. See `.env.example` for all keys.

## Checks

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

`npm run format` rewrites files with Prettier.
