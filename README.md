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

## Hybrid retrieval

`RETRIEVER` picks where the reranker's candidates come from (E8-4):

- `tags` (default): tag search with the full-text fallback, as above, up to `MAX_CANDIDATES`.
- `bge`: bge-m3 hybrid search. Chunks of a provision the instruction names come first (see below). The instruction is embedded (law abbreviations spelled out, see [Local models](#local-models)) and compared with every chunk's vector by cosine similarity (the dense half). SQLite FTS5 ranks the chunks by BM25 for the instruction's words and numbers, with law abbreviations replaced by their SFS number so `7 § LAS` matches `SFS 1982:80 7 §` (the lexical half). The two rankings are fused by reciprocal rank fusion and the best `RETRIEVE_CANDIDATES` (default 40) go on. The query is not translated into tags.
- `both`: the tag ranking fused with the two halves of `bge` the same way.

Each ranking adds `weight / (RRF_K + rank)` to a chunk's score; `RRF_K` (default 60) and `RRF_WEIGHT_DENSE` / `RRF_WEIGHT_LEXICAL` / `RRF_WEIGHT_TAGS` (0–1, default 1) tune the fusion.

```bash
npm run index:embed                                         # embed every new or changed chunk
npm run retrieve -- "konkurrensklausul efter anställningens slut" [--top-k 8]
```

`index:embed` embeds each chunk's heading path and text with the configured embedder and stores the vector in SQLite (`chunk_embeddings`), keyed by the model, precision (`EMBEDDER_DTYPE`) and a hash of the text. A second run embeds nothing; a changed chunk, model or precision is embedded again. Neither the server nor `retrieve` nor `query` ever embeds chunks: with `RETRIEVER=bge` or `both` they fail with a message to run `npm run index:embed` when any chunk's vector is missing or stale. Embedding all chunks takes 25–45 minutes on the demo machine.

`retrieve` prints the reranked top `RERANK_TOP_K` (or `--top-k`) chunks with their source, rerank score and place in the retriever's list, and the time for query translation, embedding the question, retrieval, reranking and in total. The first question in a process also loads bge-m3 (about 4 s), which counts as embedding time; the first rerank likewise loads the reranker. `npm run query` uses the same retriever before drafting.

### Vector storage

The vectors live in SQLite as BLOBs (`chunk_embeddings`) and are loaded into one contiguous `Float32Array` when the retriever is built; a search compares the query with every chunk (brute-force cosine similarity on unit vectors). Measured on the demo machine with the whole corpus: 2,116 chunks × 1,024 dimensions = 8.7 MB in memory, 0.4 s to load (including checking every chunk's hash), and 4.8 ms per full scan (median of 100, p90 5.8 ms). Embedding the question takes far longer (about 1–5 s). A vector database or `sqlite-vec` would only pay off at a corpus hundreds of times larger, and would add a native extension; brute force needs nothing.

A chunk the instruction names by provision, e.g. "7 § LAS" or "2 kap. 9 § DL" (found as the post-check finds references), is always a candidate, ahead of the fused ranking. Neither half ranks an exact section reliably: other sections of the same law share its words, and its section number is a common token.

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

## Reranking

The relevance step sits behind one `Reranker` interface (`backend/src/rerank/`). `RERANKER` in `.env` picks the implementation, and nothing else in the code branches on it:

- `bge` (default): the local cross-encoder bge-reranker-v2-m3 (see [Local models](#local-models)). It scores each chunk's heading path and text against the instruction and turns the logit into a score with a sigmoid. Pairs over 1,024 tokens are cut at the end of the chunk, with a warning. Its scores are not calibrated like JEV's or the LLM's, so it has its own threshold, `RERANK_THRESHOLD_BGE` (default 0: only `RERANK_TOP_K` cuts); `RERANKER_DTYPE` (`int8` default, or `fp32`) and `RERANKER_BATCH_SIZE` (default 8) tune it. Nothing is cached.
- `llm`: the judge's LLM (`LLM_JUDGE_PROVIDER`/`LLM_JUDGE_MODEL`), asked for the probability that the answer is yes.
- `jev`: JEV, with the chunk as the state and the question as one Noul question. When a JEV call fails (timeout, network or HTTP error, malformed answer), the judge's LLM answers that chunk instead, and a warning names the chunk and the cause. Needs `JEV_API_KEY`; without it the server refuses to start.
- `qwen3`: a placeholder for a later experiment.

`JUDGE_IMPL` was replaced by `RERANKER`; a `.env` that still sets it fails at startup. A reranker scores every candidate, drops those below the threshold and unknown chunks, and returns the best `RERANK_TOP_K` (default 8), best first. Every reranker returns the same shape: the chunk, a score from 0 to 1, the reranker and its model. Adding one is a new file with a `RerankerEntry` and one entry in `RERANKERS` (`backend/src/rerank/factory.ts`).

The `jev` and `llm` rerankers ask the same question about the same text: the chunk's source reference and text, "Är texten relevant för följande uppdrag: <instruktion>?". A chunk is relevant when its score reaches `JUDGE_THRESHOLD` (default 0.5).

An `Embedder` interface (`backend/src/embedding/`, `EMBEDDER=bge`) gives the local bge-m3 embeddings (see [Local models](#local-models)); E8-4 builds the vector index on it.

JEV gets `JUDGE_TIMEOUT_MS` (default 10000) per judgement and is not retried. Chunks are sent whole; one that JEV refuses as too large falls back like any other JEV error.

### Parallel judging and the judge cache

The `jev` and `llm` rerankers judge through `judgeAll(instruction, chunks, deps, { cache })`. It judges a query's candidate chunks with the judge from `createJudging` (the judge, its cache identity and the threshold, from one config) in parallel, at most `JUDGE_CONCURRENCY` (default 8) calls at a time. A chunk whose judgement fails, or takes longer than `JUDGE_CHUNK_TIMEOUT_MS` (default 30000, fallback included), is `unknown`: it counts as not relevant, and a warning names it. When `JUDGE_TOTAL_TIMEOUT_MS` (default 60000) is reached, calls in flight are cancelled, every chunk not yet judged is `unknown`, and the judgements finished so far are returned.

Scores of the `jev` and `llm` rerankers are cached in the `judge_cache` table:

- The key is the question asked about the instruction (trimmed, lower-cased, whitespace collapsed), the judge (JEV for `jev`, else the LLM), its model and the chunk. A chunk whose text has changed is judged again.
- Only the primary judge's scores are stored, so an LLM fallback answer is asked for again next time.
- Relevance is decided against the current `JUDGE_THRESHOLD` when the score is read, so changing the threshold needs no new calls.
- `JUDGE_CACHE=off`, or `{ cache: false }` per call, skips the cache entirely, e.g. for timing measurements. Deleting the table's rows clears it.

The result has each chunk's status (`judged`, `cached` or `unknown`), score, relevance, judge and time, plus the total time, cache hits, judge calls, unknown chunks and tokens used.

### JEV limits

TypeSafe does not document JEV's maximum state size, pricing or rate limits. `npm run jev:probe` measures them against the real API with the judge's timeout `JUDGE_TIMEOUT_MS` (needs `JEV_API_KEY`; the calls are billed): latency over 10 sequential calls, the largest state accepted (doubling from 1,000 characters) and how a burst of 20 concurrent calls is answered.

**Observed so far: nothing.** The project has no JEV key yet, so the limits are not measured, and JEV's request shape is only checked against the documentation with faked responses. Run the probe once a key exists and record the results here.

## Local models

bge-m3 (embeddings) and bge-reranker-v2-m3 (reranking) run locally, in Node, through [transformers.js](https://github.com/huggingface/transformers.js) 3.x on onnxruntime-node, on the CPU. They are downloaded from Hugging Face on first use into `MODEL_CACHE_DIR` (default `data/models.nosync`, git-ignored; the `.nosync` suffix keeps iCloud Drive from uploading the models when the repo is in a synced folder such as `~/Documents`): about 0.6 GB per model in int8 and 2.3 GB in fp32. `EMBEDDER_DTYPE` picks the precision (`int8` by default).

```bash
npm run embed:smoke                   # "7 § LAS" must be nearer LAS 7 § than Dataskyddslagen 1 kap. 7 §
npm run models:bench -- --dtype int8  # load and run times, peak memory (once per precision)
```

### Runtime decision (E8-2)

Measured on the demo machine (MacBook Pro, Intel Core i5-8257U, 4 cores, 8 GB RAM, no GPU), with `npm run models:bench`: load time from the local cache, 100 real chunks (about 1,000 characters each) embedded in batches of 8, 100 (instruction, chunk) pairs scored in batches of 8 with at most 1,024 tokens, and the process's peak resident memory with both models loaded (`maxRSS`).

| dtype | bge-m3 load | embed 100 chunks | reranker load | score 100 pairs | peak RSS |
| ----- | ----------- | ---------------- | ------------- | --------------- | -------- |
| int8  | 3.7 s       | 73.1 s           | 4.1 s         | 74.5 s          | 1.84 GB  |
| fp32  | 8.1 s       | 100.2 s          | 9.6 s         | 116.2 s         | 2.37 GB  |

Run-to-run variation on this laptop is large: earlier runs, with other work on the machine, took 117–125 s (int8) and 114–120 s (fp32) to embed the same 100 chunks.

**Decision: transformers.js in Node, no Python sidecar.**

- Both models load and run in TypeScript. A sidecar would run the same models on the same four cores, so it could not remove the cost their size sets (below); it would only add a second runtime.
- The time is set by the models' size: each has about 568M parameters, so a chunk of a few hundred tokens takes 0.7–1.2 s on this CPU. int8 is up to about a quarter faster than fp32 here and a quarter of the download, and is the default; E8-5 decides between them on recall.
- Embedding all ~2,100 chunks once (E8-4) takes roughly 25–45 minutes; reranking 30 candidates takes roughly 20–40 seconds per query.
- Peak memory stays under 2.4 GB with both models loaded, even in fp32, which leaves room on the 8 GB machine.
- transformers.js **3.x**, not 4.x: 4.x requires onnxruntime-node 1.30, which ships no Intel macOS binary; 3.x uses 1.21, which does.
- `npm audit` reports 6 advisories through transformers.js 3.x (2 high in `sharp`, its image library; 4 moderate in `global-agent`/`sprintf-js`, used only by onnxruntime-node's install script, which npm does not run here). The project processes no images and never runs that script, so none of the vulnerable code is reached. The only fix is transformers.js 4.x; move to it when the demo machine is Apple Silicon or ONNX Runtime ships an Intel macOS binary again.

**Sparse output is not available.** The ONNX export gives bge-m3's dense vectors only; its sparse (lexical) weights come from a separate `sparse_linear.pt` head that is not part of any ONNX repackaging. E8-4 therefore uses SQLite FTS5 BM25 as the lexical half of hybrid search.

**Law abbreviations.** bge-m3 does not know Swedish law abbreviations: "7 § LAS" came out nearer Dataskyddslagen 1 kap. 7 § (cosine 0.485) than LAS 7 § (0.478), in int8 and fp32 alike. The embedder therefore spells out known abbreviations in queries (E6-3's table: "7 § LAS" → "7 § LAS (Lag (1982:80) om anställningsskydd)"), after which LAS 7 § wins clearly (0.578 against 0.474).

### Rerank latency (E8-3)

`npm run bench:rerank -- --dtype int8|fp32` reranks 30 and 50 real chunks (spread over the corpus, 1,033 characters on average) against a Swedish instruction on the demo machine, 5 runs each, in batches of 8 pairs of similar length:

| dtype | 30 chunks (median of 5) | 50 chunks (median of 5) | model load |
| ----- | ----------------------- | ----------------------- | ---------- |
| int8  | 29.2 s                  | 54.6 s                  | 4.2 s      |
| fp32  | 41.7 s                  | 79.2 s                  | 9.7 s      |

Measured with a 1-minute load average of 3.9 at the start (iCloud Drive was still syncing); the model load includes scoring one pair. Batching pairs of similar length made this about 15–20 % faster than batching in candidate order (35.9 s and 64.6 s in int8). int8 is about 30 % faster than fp32 here. At about 1 s per chunk, reranking 30 candidates takes about half a minute per query on this laptop.

### Licences

Checked on the Hugging Face model cards on 2026-10-11:

| Model              | Repository used                                                                                                                                                                                    | Licence                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| bge-m3             | [`Xenova/bge-m3`](https://huggingface.co/Xenova/bge-m3) (ONNX), from [`BAAI/bge-m3`](https://huggingface.co/BAAI/bge-m3)                                                                           | MIT (both)                                                                                         |
| bge-reranker-v2-m3 | [`onnx-community/bge-reranker-v2-m3-ONNX`](https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX) (ONNX), from [`BAAI/bge-reranker-v2-m3`](https://huggingface.co/BAAI/bge-reranker-v2-m3) | Apache-2.0 (BAAI); the ONNX repackaging states no licence of its own and inherits the base model's |

## Evaluation

`eval/queries.yaml` holds 20 lawyer instructions (10 employment agreements, 10 NDAs, 6 with a template). Each lists the chunks relevant to it, by document identifier and stored source reference. Claude drafted the queries and marked the chunks from the candidates `eval:label` lists, and the owner reviews the file.

```bash
npm run eval:label -- anst-01 [--chars 300]   # candidates for one query: tag search, then full text
npm run eval:run                              # precision, recall and the threshold sweep
```

`eval:run` runs every query through four modes and prints precision and recall (macro averages over the queries):

- `tags`: tag-search candidates (E4-1);
- `tags+jev`: those candidates as approved by the `jev` reranker;
- `tags+llm`: the same, with the `llm` reranker;
- `fts`: full-text candidates only (E4-3).

Here a reranker keeps every relevant candidate, not only `RERANK_TOP_K`, so the numbers stay comparable with the first run. For each judge mode, thresholds from 0.1 to 0.9 are applied to the judge's scores, and the threshold with the highest F1 is recommended. The judge cache is on, so the sweep and repeated runs cost no new calls. The full report, with one row per query, goes to `reports/eval-<timestamp>.md`.

Without `JEV_API_KEY`, `tags+jev` is answered by the `llm` reranker, and the report says so. To run without the paid API, use the Claude Code provider. It starts the `claude` CLI without `ANTHROPIC_API_KEY`, so the calls go to your subscription even when `.env` has a key. A `claude` call takes several seconds, so give the judge more time than the defaults, which are sized for JEV and the API:

```bash
LLM_PROVIDER=claude-code LLM_MODEL=claude-haiku-5-5 LLM_TIMEOUT_MS=120000 \
  JUDGE_CHUNK_TIMEOUT_MS=150000 JUDGE_TOTAL_TIMEOUT_MS=600000 npm run eval:run
```

The first run's report is kept in `eval/report-2026-10-11.md`. A query that fails, e.g. because the CLI keeps failing, is listed in the report and left out of the averages, and the command exits non-zero.

### Comparing retrievers and rerankers

```bash
npm run eval:run -- --reranker bge,llm [--retriever tags,bge,both]
```

With `--reranker`, `eval:run` compares rerankers instead (E8-5). Every query goes through each retriever (`--retriever`, default the configured `RETRIEVER`; `fts` is always added as a baseline), and each candidate list through each reranker, which keeps every relevant candidate. One row per retriever and reranker gives recall@5/@8/@10 and recall over all candidates, before rerank (the retriever's own order, reranker `none`) and after it, precision@5/@10 after rerank, and the median and p90 latency per query of the rerank and of retrieval. The table is printed and appended to the table in that day's `eval/report-<date>.md`; every report has the same columns, so rows from different days, e.g. JEV once credits exist, can be put side by side. The command exits non-zero when queries failed.

- `tags` here is E5-3's tag search without the full-text fallback; `bge` and `both` need `npm run index:embed`.
- A reranker that cannot run is a skipped row with the reason, e.g. `jev` without `JEV_API_KEY` or `qwen3` (not implemented); the others still run.
- The local models are loaded before anything is timed. A reranker whose scores came from the judge cache takes its latency from the queries without cache hits, or, with fewer than 5 of those, from a cache-off pass over the first 5 queries; its row says which.
- BGE in int8 and fp32 are two runs: `RERANKER_DTYPE=int8` and `RERANKER_DTYPE=fp32`.

### Switch reranker in three steps

1. Set `RERANKER=` in `.env`: `bge` (local, default), `llm`, `jev` or `qwen3` (not implemented yet).
2. Fill in what it needs: `JEV_API_KEY` for `jev`; the judge's LLM settings for `llm`; nothing for `bge`, whose model downloads into `MODEL_CACHE_DIR` on first use (`RERANKER_DTYPE` picks int8 or fp32).
3. Verify with `npm run retrieve -- "<question>"` (one question, the reranked chunks and their scores) or `npm run eval:run -- --reranker <name>` (the evaluation set).

Nothing else changes: the query flow and `eval:run` only know the `Reranker` interface.

## Prompt templates

The generator drafts contracts from the Swedish prompt templates in [`prompts/`](prompts/): `employment.md` (employment agreement) and `nda.md` (NDA), one per template id. Each template fixes the required contract sections, the inline citation format `[K:<chunk-id>]`, the `[lön]`-style placeholders for details the instruction does not give, the fictional default parties and the not-legal-advice disclaimer. [`prompts/README.md`](prompts/README.md) documents the file structure, the slots and the citation format.

## Query and draft

`npm run query` runs the whole query flow in the terminal: query translation, candidate search (`tags+fts`), reranking and the draft.

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

The reranker keeps at most `RERANK_TOP_K` (default 8) approved chunks. They go to the generator best first, up to `GENERATOR_MAX_CHUNKS` (default 20) and `GENERATOR_MAX_CONTEXT_CHARS` (default 60 000). When the limits leave chunks out, the output says how many and prints the same command with `--max-chunks` and `--max-context-chars` large enough to include them all. Running it again repeats the whole flow. Judge scores that are cached (from JEV with `RERANKER=jev`, or from the LLM with `RERANKER=llm`) are reused, but LLM answers standing in for a failed JEV call are not cached, and an LLM query translator may pick other tags, so the rerun can find somewhat different chunks. When the judge approves nothing, or no approved chunk fits the limits, no draft is written.

Example drafts for both templates, made with the Claude Code provider, are in [`prompts/examples/`](prompts/examples/). To run on the subscription instead of the paid API, use the settings they were made with (`RERANKER=llm`, called `JUDGE_IMPL=llm` then, reuses the evaluation's cached LLM scores while there is no JEV key):

```bash
LLM_PROVIDER=claude-code LLM_MODEL=claude-haiku-5-5 LLM_GENERATOR_MODEL=claude-sonnet-5-5 \
  RERANKER=llm JUDGE_CHUNK_TIMEOUT_MS=150000 JUDGE_TOTAL_TIMEOUT_MS=900000 \
  npm run query -- "Sekretessavtal för en konsult som får tillgång till kunddata och affärsplaner." --template nda
```

The token line shows the normally billed input plus cache writes and reads (e.g. `in 2 + cache 41230`), since with the Claude Code provider most of the input can be cache traffic.

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
