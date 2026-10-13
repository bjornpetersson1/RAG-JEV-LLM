# E7-10 · Label the chunks only vector search finds

- **Issue:** [#95](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/95)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** E7-9 (#94) (related: E7-6 (#79))
- **Status:** Approved

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

- [ ] `labelCandidates`: add the dense search; mark each candidate with every search that found it.
- [ ] `formatCandidates`: the per-search marks and counts.
- [ ] `eval:label` CLI: build the dense search from `EMBEDDER`, its vectors and `MAX_CANDIDATES`.
- [ ] Tests with a fake embedder and vector index.
- [ ] Run `eval:label` for the 20 queries; add and grade the relevant dense candidates, with `# E7-10` comments and a header note.
- [ ] Re-run `bench:compare -- --runs 1` with drafts and write the report section.
- [ ] README's evaluation section: `eval:label` lists dense candidates.

## Decisions

- **Claude labels the dense candidates** (owner). As in E5-3 and E7-4: each candidate read against its instruction, graded by E7-4's rule. The owner's review stays in #79.
- **A candidate is marked with every search that found it** (owner). The overlap shows which chunks only vectors find; the listing today counts a chunk found by both tags and full text as `tags`, which becomes `tags+fts`.
- **Added labels are noted with an `# E7-10` comment and counted in the report** (owner). No loader or type change.
- **Re-run only `bench:compare -- --runs 1` with drafts** (owner). The same run as E7-9, so every column is compared on the new labels. No `eval:run` or sweep.
- **The dense candidate count is `MAX_CANDIDATES`** (issue): what the reference RAG gives its judge.
- **Only dense candidates not already marked are reviewed** (default). Tag and full-text candidates were reviewed in E5-3 and E7-4.

## Open Questions

- None.
