# E7-10 · Label the chunks only vector search finds

- **Issue:** [#95](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/95)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** E7-9 (#94) (related: E7-6 (#79))
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 937 tests (878 backend, 59 frontend; `npm test` offline under sandbox-exec, loopback only) and build exit 0; `eval:label` run for all 20 queries; `bench:compare -- --runs 1` with drafts, 20 queries, no failures, in `eval/report-2026-10-13.md`)

## Summary

`eval:label` also lists the reference RAG's vector-search candidates, Claude labels the relevant ones for all 20 queries, and `bench:compare` is re-run, so precision and recall no longer favour the main flow because the labels were made from tag and full-text candidates only.

## Goals

- `eval:label` lists tag, full-text and dense candidates, each marked with every search that found it.
- The dense candidates of every query in `eval/queries.yaml` are reviewed; the relevant ones are added with `grade: central` or `grade: related` (E7-4's rule).
- `bench:compare -- --runs 1` with drafts is re-run on the new labels, and the report compares the flows with numbers.

## Non-goals

- Re-reviewing the existing labels, or the tag and full-text candidates that were already shown. The owner's review of `eval/queries.yaml` stays in #79.
- Re-running `eval:run`, the sweep or the reranker comparison. Earlier report sections keep their numbers on the old labels.
- Changing either flow, its defaults or the judge.
- A field in the YAML or the loader for where a label came from.
- Five benchmark runs. One run with drafts, as in E7-8 and E7-9.

## Acceptance Criteria

1. **`eval:label` lists tag, full-text and dense candidates, each marked by the search that found it; a test with a fake embedder proves it.**
   - The dense candidates are the `MAX_CANDIDATES` chunks nearest the instruction by cosine, found as the reference RAG finds them (`EMBEDDER` and its stored vectors).
   - Each candidate is listed once, marked with every search that found it (e.g. `tags+dense`, `fts`, `dense`).
   - Order: tag hits, then full-text hits not already listed, then dense hits not already listed.
   - The header line gives the count per search and the number found only by vectors.
   - If the chunks are not embedded with the configured embedder, the command fails naming `npm run index:embed`.
   - A unit test with a fake embedder and vector index covers a chunk found by tags and vectors, one only by full text, and one only by vectors, in the listing and the formatted text.
2. **Every query in `eval/queries.yaml` has had its dense candidates reviewed, and the report says how many labels were added.**
   - `npm run eval:label -- <id>` was run for all 20 queries, and every dense candidate not already marked was read against its instruction.
   - Each added label has `grade: central` or `grade: related` by E7-4's rule and an `# E7-10` comment on its entry.
   - The file header says the dense candidates were reviewed in E7-10.
   - `eval/queries.yaml` still loads (the loader's tests and `bench:compare` read it).
   - The report gives the number of labels added, per query and in total, split by grade.
3. **The report compares the two flows on the new labels, with numbers.**
   - A new `bench:compare -- --runs 1` with drafts (the Claude Code provider, judge cache off) has its row pair in that day's `eval/report-<date>.md`, under the existing "Main flow vs reference RAG: the same judge" table.
   - The analysis states, for both flows and with numbers, precision, recall, source accuracy, time to sources, total time and pairs without a draft, and how precision and recall moved against E7-9's run.
   - It says how much of E7-9's relevance gap was the label bias, and what differences remain.
4. **`npm test` runs without network access.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0, with `npm test` offline.

## Tasks

- [x] `labelCandidates`: add the dense search; mark each candidate with every search that found it.
- [x] `formatCandidates`: the per-search marks and counts.
- [x] `eval:label` CLI: build the dense search from `EMBEDDER`, its vectors and `MAX_CANDIDATES`.
- [x] Tests with a fake embedder and vector index.
- [x] Run `eval:label` for the 20 queries; add and grade the relevant dense candidates, with `# E7-10` comments and a header note.
- [x] Re-run `bench:compare -- --runs 1` with drafts and write the report section.
- [x] README's evaluation section: `eval:label` lists dense candidates.

## Decisions

- **Claude labels the dense candidates** (owner). As in E5-3 and E7-4: each candidate read against its instruction, graded by E7-4's rule. The owner's review stays in #79.
- **A candidate is marked with every search that found it** (owner). The overlap shows which chunks only vectors find; the listing today counts a chunk found by both tags and full text as `tags`, which becomes `tags+fts`.
- **Added labels are noted with an `# E7-10` comment and counted in the report** (owner). No loader or type change.
- **Re-run only `bench:compare -- --runs 1` with drafts** (owner). The same run as E7-9, so every column is compared on the new labels. No `eval:run` or sweep.
- **The dense candidate count is `MAX_CANDIDATES`** (issue): what the reference RAG gives its judge.
- **Only dense candidates not already marked are reviewed** (default). Tag and full-text candidates were reviewed in E5-3 and E7-4.

- **Settled while implementing:**
  - **`createLabelDenseSearch` builds the dense half from `EMBEDDER`, its stored vectors and the reference's `MAX_CANDIDATES`** (`loadReferenceConfig`), with the reference's own `createDenseSearch`, so the listing finds what the reference RAG finds. The test passes a fake embedder whose vectors `index:embed` stored in a test database.
  - **The candidate count line gives the count per search and how many only vectors found**, e.g. `73 candidates (tags 30, fts 30, dense 30; 22 only dense)`. Every query had 30 dense candidates, 10–26 of them found only by vectors (400 in all).
  - **Every unmarked dense candidate was read, including those tags or full text also found.** The query translation varies between runs, so a chunk `tags+dense` today may not have been in E5-3's listing.
  - **149 labels were added (24 central, 125 related)**: 415 labels in all, 155 central. Generic sections that vector search finds for many queries (e.g. LAS 4 §, 5 §, bemanningslagen 12 a §, MBL's collective-agreement rules) were left out where they do not bear on the instruction, as in E5-3.
  - **The report also compares the candidates before the judge, on old and new labels** (the share of each search's 30 candidates labelled relevant, from the same `eval:label` listings). `bench:compare` keeps no per-query chunk ids, so E7-9's run cannot be re-scored on the new labels; the candidate table separates the labels' effect from run-to-run noise.
  - **The new rows sit under the existing "the same judge" table**, as `bench:compare` appends them; the report section says they are the second row pair dated 2026-10-13.
  - **The run was made with `ANTHROPIC_API_KEY=sk-ant-invalid-test`**, so every LLM call (query translation in `eval:label`, and all roles in `bench:compare`) went through the subscription.
- **Clean code:** reviewed inline, without simplify's four agents (about 130 lines of code, as in E7-9). `foundByLabel` names the `tags+dense` label that the listing printed and measured twice.
- **Code review (high):**
  - **Fixed: the dense count comes from `loadSearchConfig` (`MAX_CANDIDATES`)**, not `loadReferenceConfig`, so `eval:label` does not validate an LLM judge it never uses.
  - **Fixed: the dense search runs while the query is translated** (`Promise.all`), and each search's ids are a `Set`.
  - **Fixed: the report no longer calls the reversal a result.** The labels no longer favour tags but may favour vectors, since the tag-only candidates were not reviewed again; the report says vectors are at least as good as tags, not better. It says every query had 30 tag hits (no full-text fill), so the tag row is what the main flow's judge saw, and that the slower embedding is unexplained rather than noise.
  - **Not changed: `eval:label` fails when the chunks are not embedded.** Acceptance criterion 1 asks for that: a listing without the dense half would hide exactly the candidates this issue is about. The error names `npm run index:embed`.
  - **Not changed: a shared reference-search builder.** Both paths already share `loadRetrievalResources`, `createDenseSearch` and `MAX_CANDIDATES`; a builder in `reference/setup.ts` would either bring back the judge validation (the first fix) or split `loadReferenceConfig`, outside this spec.
  - **Follow-up for the owner:** reviewing the tag-only candidates with today's translation would remove the remaining bias. It is not part of this issue (Non-goals); the report names it.

## Open Questions

- None.
