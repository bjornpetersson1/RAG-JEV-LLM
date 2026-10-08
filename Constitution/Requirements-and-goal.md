# Requirements spec: Legal RAG (POC)

Oct 8, 2026 · @Björn Petersson

This is a proof of concept that finds relevant parts of Swedish laws and court rulings using tags and a judge model (JEV), and lets an LLM generate employment agreements and NDAs from them. The goal is a demo that runs locally on your computer and can be broken down into issues.

## Goal and scope

The POC should show that tag-based search plus a small judge model returns relevant sources faster than a regular RAG, and that an LLM can write a useful contract draft from them. It runs locally and is demoed from your computer.

**In scope**

- Ingestion of a selection of Swedish laws and a selection of court rulings (enough for a demo, not the whole corpus)
- Splitting into chunks and automatic tagging with an LLM at indexing time
- Tag-based search through an index, with full-text search as a fallback
- JEV judging each candidate chunk as relevant or not
- Generation of employment agreements and NDAs with source references to statute provisions or cases
- A React web UI with free text and template selection, plus timing per step

**Out of scope**

- Login, user accounts, multi-tenancy or cloud deployment
- A complete or automatically updated legal source database
- Preparatory works and legal doctrine
- Legal guarantees: the drafts are source material, not legal advice

## Open points and assumptions

JEV is TypeSafe's model that returns structured answers instead of text: you send a text (state) and one or more questions and get values back ([documentation](https://docs.typesafe.ai/introduction)). For us the Noul question is the important one, since it returns the probability, from 0 to 1, that a statement is true. The call is a REST request with an API key, and the documentation only shows a Python SDK, so the spec calls it directly from TypeScript. Remaining gaps are listed in the table.

| Point | Assumption in the spec | Needs confirmation |
| --- | --- | --- |
| JEV | The chunk is sent as state and the lawyer's instruction as a Noul question. The answer (0–1) is compared to a threshold, starting at 0.5. Fallback: a regular small LLM behind the same interface. | The right threshold, determined on the evaluation set (E5-3) |
| Bloom filter | The default is an inverted index tag → chunk id (roaring bitmaps). The bloom filter is built as an alternative implementation and compared in the measurements. | Whether a bloom filter is a requirement for the demo |
| Data sources | Open Swedish sources for laws and rulings. A selection of a few hundred documents is enough. | Exact sources and license, verified in the first issue |
| Tags | A fixed tag vocabulary (a few hundred tags, e.g. employment, termination, non-compete, confidentiality) that the LLM picks from at indexing time. | Who approves the vocabulary |
| LLM | Cloud API for tagging, judging and generation. Model choice in configuration. | Which provider and monthly budget |
| Stack | TypeScript on both sides: Node backend, React frontend, SQLite for storage. JEV is called directly over REST. | You wrote "React maybe" |
| Language | Sources, tags and drafts are in Swedish. | None |
| JEV limits | The documentation does not state a maximum state size, pricing or rate limits. Chunks are kept short, and calls are made per chunk with a configurable concurrency limit. | Check in TypeSafe's console and measure in E5-1 |

## Flow and technical constraints

The system has two flows: one that runs once at indexing time and one that runs for every query.

**Indexing (offline)**

1. Fetch laws and rulings and store the raw data with source and date.
2. Split into chunks by the document's structure (chapter and section for laws, sections for rulings) and keep an exact source reference per chunk.
3. Let an LLM pick tags from the fixed vocabulary for each chunk.
4. Build the index tag → chunk id, plus a simple full-text index as a fallback.

**Query (online)**

1. The lawyer's instruction (free text or template) is translated into tags, by JEV or an LLM depending on configuration.
2. The index returns candidate chunks. If too few are found, full-text search fills in.
3. JEV receives each candidate chunk as state, with the lawyer's instruction as a yes/no question (Noul), and only chunks above the threshold are kept. Calls are made in parallel per chunk.
4. An LLM receives the instruction and the approved chunks and writes the contract with source references.
5. The UI shows the draft, which sources were used and the time per step.

**Technical constraints**

- Everything except the LLM calls runs locally. No hosted databases or services.
- Storage in SQLite. The index is loaded into memory at startup.
- LLM calls go through one interface per role (tagger, query translator, JEV, generator), so model and provider are switched in configuration.
- Calls to JEV are made in parallel per chunk. Tagging of chunks happens at indexing time and does not affect response time. Time during a query goes to query translation, JEV and generation, which are the likely bottleneck, not the search itself.
- API keys live in a `.env` file that is not committed. The test data in the repo is small enough to download in a few minutes.

## Parts and issues

Seven parts (E1–E7). Each item is meant to be one issue that takes roughly half a day to a full day, and "Done when" is its acceptance criterion.

### E1 Project foundation

- [ ] **E1-1 Repo and skeleton**: backend (Node + TypeScript) and frontend (React + Vite) in one repo.
  - Done when: one command starts both, and lint and tests run.
- [ ] **E1-2 LLM interfaces**: the interfaces Tagger, Judge and Generator, with a real implementation against a cloud API and a fake for tests.
  - Done when: switching models is done via `.env`, and the tests run without network access.
- [ ] **E1-3 Database schema**: SQLite tables for documents, chunks, tags and chunk tags.
  - Done when: the migration runs from an empty database without errors.

### E2 Data ingestion

- [ ] **E2-1 Sources**: choose and verify sources for laws and rulings, and document format and license in the README.
  - Done when: a selection around employment, contracts and confidentiality (about 10 laws and 50 rulings) is in the repo as raw data or can be fetched with one command.
- [ ] **E2-2 Law import**: read law text into documents.
  - Done when: each law has title, SFS number and date in the database.
- [ ] **E2-3 Ruling import**: read rulings into documents.
  - Done when: each ruling has court, case number and date in the database.
- [ ] **E2-4 Chunking**: split by structure and store a source reference per chunk.
  - Done when: laws are split per chapter and section, rulings per section, and each chunk points to the exact place in the source.

### E3 Tagging

- [ ] **E3-1 Tag vocabulary**: a file with 100–300 tags in Swedish.
  - Done when: you have reviewed and approved the list.
- [ ] **E3-2 Tagger**: an LLM picks 3–8 tags from the vocabulary per chunk.
  - Done when: tags outside the vocabulary are discarded, re-running creates no duplicates, and the cost is logged.
- [ ] **E3-3 Control report**: number of chunks per tag and a list of chunks without tags.
  - Done when: the report is printed after every tagging run.

### E4 Index and search

- [ ] **E4-1 Inverted index**: tag → chunk id with bitmaps, with AND and OR search.
  - Done when: unit tests pass, and a search over 100,000 synthetic chunks takes under 5 ms.
- [ ] **E4-2 Bloom filter variant**: the same search interface, implemented with one filter per chunk or a bit-sliced index.
  - Done when: the same test suite passes, and the false positive rate is reported.
- [ ] **E4-3 Full-text fallback**: SQLite FTS5 is used when tags give fewer than N candidates.
  - Done when: N is configurable and the fallback shows in the log when it is used.
- [ ] **E4-4 Query translator**: instruction → tags, with two implementations behind the same interface: an LLM and JEV. JEV receives the instruction as state and one Noul question per tag ("Is the text about \<tag description>?"), and tags above the threshold are selected. If the number of questions per call is limited, the tags are divided into areas, and a Choice question picks the area first. Templates have their own preset tags.
  - Done when: a free instruction and a template selection each give a valid tag set with both implementations, and the choice is made in configuration.

### E5 JEV

- [ ] **E5-1 Judge adapter**: an adapter for JEV plus a fallback with a small LLM behind the same interface. Called with POST against TypeSafe's REST API, with the key in `.env`.
  - Done when: both implementations return relevant/not relevant and a value per chunk, the threshold is configurable, and the fallback is used if JEV does not respond.
- [ ] **E5-2 Parallel judging**: candidates are judged concurrently with a concurrency limit and timeout, and results are cached per query and chunk.
  - Done when: running the same query twice makes the second run without new calls.
- [ ] **E5-3 Evaluation set**: 20 queries with manually marked relevant chunks.
  - Done when: precision and recall are printed for tag search, tag search + JEV, and full-text search only.

### E6 Generation

- [ ] **E6-1 Prompt templates**: one template for employment agreements and one for NDAs, with room for context and instruction.
  - Done when: both templates produce a complete draft with fictional parties.
- [ ] **E6-2 Generator**: instruction + approved chunks produce a draft with source references.
  - Done when: every reference points to a chunk that was sent in.
- [ ] **E6-3 Post-check**: references that do not match a submitted chunk are flagged.
  - Done when: a deliberately wrong reference in a test is flagged.

### E7 UI and measurement

- [ ] **E7-1 Form**: template selection (employment agreement or NDA) and a free text field.
  - Done when: both paths start the same flow.
- [ ] **E7-2 Result view**: the draft, and a source list where the chunk text can be opened.
  - Done when: every source reference in the draft is clickable.
- [ ] **E7-3 Timing panel**: time for translation, search, JEV and generation, plus total time.
  - Done when: the numbers are shown in the UI and logged to a file per run.

## Order and dependencies

Build query-to-draft in the terminal first (phase 4) and put the UI on top, so that something runnable exists as early as possible. The JEV adapter can be built right away, since the API is documented. The fallback with a regular LLM is only needed if JEV does not respond and for the comparison.

| Phase | Issues | Requires | Done when |
| --- | --- | --- | --- |
| 1. Foundation | E1-1, E1-2, E1-3 | – | Tests and dev server run |
| 2. Data | E2-1 to E2-4 | E1-3 | Chunks with source references are in the database |
| 3. Tags and index | E3-1 to E3-3, E4-1, E4-3 | E2-4 | A test query returns candidate chunks via tags |
| 4. Judging and generation | E4-4, E5-1, E5-2, E6-1 to E6-3 | Phase 3 | A query produces a draft with sources in the terminal |
| 5. UI and measurement | E7-1 to E7-3, E4-2, E5-3 | Phase 4 | The demo works and the measurement can be run |

E4-2 (bloom filter) can be done at any time after E4-1, but not before phase 4 if time gets tight.

## Measurement

"Faster" is proven with measurements against a reference RAG built in the same repo, on both total time and search time. A numeric target is set only after the first measurement, because the search probably takes milliseconds and the time instead goes to the LLM calls.

| Measure | How it is measured | Compared against |
| --- | --- | --- |
| Total response time | From submitted query to finished draft | Reference RAG |
| Search time | From tags to candidate list | The reference RAG's vector search, and bloom filter against inverted index |
| LLM time | Sum of query translation, JEV and generation | Shows where the time goes |
| Relevance | Precision and recall on the 20 evaluation queries (E5-3) | Reference RAG |
| Source accuracy | Share of references that point to a submitted chunk (E6-3) | – |
| JEV vs LLM as judge | The same queries and candidate chunks are judged by both: time per chunk, total judging time, precision and recall | Each other |
| JEV vs LLM as query translator | Time from instruction to tags, and how large a share of the candidate chunks are the same with both | Each other |

Each query is run five times and the median is reported.

- [ ] **E5-4 Reference RAG**: a simple RAG with embeddings and top-k that uses the same chunks and the same generator.
  - Done when: it can be run on the evaluation queries and gives the same measures as the main flow.

## Demo

The POC is done when the following scenario can be run from your computer without anything being swapped by hand.

1. You choose the employment agreement template and write an instruction, for example a permanent employment with a six-month probation period and a non-compete clause.
2. The UI shows which tags the query became, how many candidate chunks were found and how many JEV approved.
3. The draft is shown with source references, and clicking a reference shows the chunk text.
4. The timing panel shows time per step and total time, next to the same query run against the reference RAG.
5. The same flow is run for an NDA.

Send the spec to Claude Code together with this instruction: create one issue per item in Parts and issues, with "Done when" as acceptance criteria and dependencies as in Order and dependencies.
