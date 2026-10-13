# E7-2 · Result view

- **Issue:** [#23](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/23)
- **Labels:** `E7 UI and measurement`
- **Phase:** 5. UI and measurement
- **Depends on:** E7-1 (#22), E6-3 (#21)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 854 tests (811 backend, 43 frontend) and build exit 0; `npm run dev` with fake LLM roles and the real BGE reranker in headless Chrome: 10 reference links and 2 flags in the draft, the three source groups, and a click that opened, highlighted and scrolled to its source)

## Summary

The draft from E7-1's stream is rendered as Markdown with every source reference clickable: `[K:<id>]` citations and the free-text references (e.g. "7 § LAS") that the post-check matched to a submitted chunk. Clicking one opens that chunk's text in the source list, which shows the whole funnel: cited sources, sources sent but not cited, and the candidates the reranker turned down. References the post-check flagged are shown in red with the reason.

## Goals

- Render the draft (Markdown) with `react-markdown`; citations and matched free-text references become links to their source.
- The post-check (E6-3) also returns its matched free-text references with their positions and chunk ids.
- Source list in three groups: cited, sent but not cited, turned down by the reranker (collapsed). Each entry: `source_ref`, document title, rerank score and reranker, candidate origin (`tag`, `fts`, `dense`, `lexical`, `named`), expandable chunk text, and a link to the original source when `source_url` exists.
- Clicking a reference scrolls to its source, expands it and highlights it.
- Flagged references marked in red, with the post-check's reason as a tooltip.
- The disclaimer (drafts are source material, not legal advice) and a "copy draft" button.
- The same view for the reference flow's draft (E5-4), when it was run.

## Non-goals

- Editing the draft in the UI, or exporting it to Word or PDF.
- Changing how the generator cites, or the post-check's matching rules.
- The timing panel (E7-3).
- Showing candidates that were never reranked (beyond the candidate list), or chunk tags.

## Acceptance Criteria

1. **Every source reference in the draft is clickable and shows the chunk text.**
   - Every `[K:<id>]` citation (also in groups such as `[K:12, K:40]`) whose id was submitted is a link; clicking it scrolls to that source, expands its text and highlights it.
   - Every free-text reference the post-check matched to a submitted chunk is a link to that chunk; the post-check returns these matches with offsets, covered by a backend test.
   - A frontend test renders a draft with a single citation, a group and a free-text reference, clicks each and finds the right chunk text.
2. **Flagged references are visibly marked.**
   - A reference in `postCheck.flags` (an unknown `[K:]` id or an unmatched free-text reference) is shown in red with the reason as a tooltip, and is not a link.
   - The view shows the source accuracy and the number of flags; a frontend test covers a flagged citation and a flagged free-text reference.
3. **Source list shows all used sources.**
   - Every chunk the draft cites is in the "cited" group; every chunk sent but not cited is in the "sent, not cited" group; the reranker's turned-down candidates are in a collapsed group with their scores.
   - Each entry shows `source_ref`, document title, score with reranker name, origin, and a link to `source_url` when present (opens in a new tab).
   - A frontend test checks all three groups and an entry with and without a URL.
4. **The canonical checks pass.**
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0 without network access.
   - `npm run dev` with fake LLM roles shows a draft with clickable references; a screenshot is in the PR.

## Tasks

- [x] Post-check: return matched free-text references (offset, text, chunk id) alongside the flags.
- [x] Result: E7-1's `result` event carries the whole `QueryResult`; it gains every candidate as a source (chunk text, document title and `source_url`, candidate origin, rerank score and reranker), so the cited, sent and turned-down groups come from one list, and the post-check gains its matches.
- [x] Add `react-markdown`; turn citations and matched references into links before parsing, flags into marked spans.
- [x] Source list component with the three groups, expand and highlight.
- [x] Disclaimer and copy-to-clipboard.
- [x] README: the result view.
- [x] Tests.

## Decisions

- **The whole funnel in the source list** (owner): cited, sent but not cited, and the reranker's turned-down candidates (collapsed). It explains in the demo why a source was or was not used.
- **Link to the original source when `source_url` exists** (owner).
- **`react-markdown`** (owner): a new frontend dependency, chosen over a hand-written renderer because the model's Markdown varies. Raw HTML stays off.
- **Citations and matched free-text references are both clickable** (owner): the criterion says every reference; the post-check is extended to return its matches, not only its flags.
- **The score shown is the reranker's score and name** (default): the issue says "JEV score"; with `RERANKER=bge` or `llm` the score comes from that reranker, so the label names it.
- **"Copy draft" copies the Markdown as written** (default), including the `[K:]` citations.
- **The disclaimer is shown above the draft** (default), even though the template's last line also carries it.

- **Builds on E7-1 and E5-4 as merged** (spec update before implementing): the stream sends the whole `QueryResult` in its `result` event, so the sources and the post-check's matches go into `QueryResult` instead of separate events. A source is every candidate the flow loaded, with its candidate origin, its document's title and `source_url` (loaded with the chunk), and the reranker's score where it scored one. Which group a source falls in follows from the draft (`used`, `unused`) and the approved chunks. The reference RAG has no rerank, so its sources have no score and none are turned down.

- **Settled while implementing**:
  - **Each chunk carries its document's title and `source_url`** (`Chunk.document`), loaded with the chunk; the generator and the reranker ignore it.
  - **`QueryResult.sources`** lists every candidate in the retriever's order, with its origin, its status and, when scored, the reranker's score and name. The status says what became of it: `cited`, `sent` (but not cited), `left-out` (approved, but kept out by the context limits or with no draft written) or `turned-down`. The UI groups by it: cited and sent in the draft's order, the other two collapsed as not sent, each with its reason.
  - **The post-check's matches** (`PostCheck.matches`) have the same shape as its flags, with the chunk the reference points to; a free-text reference links to the first sent chunk it matches.
  - **References become Markdown links before parsing** (`frontend/src/references.ts`): the offsets are into the draft as written. A matched reference links to `#source-<id>`; a flagged one to `#flag` with the reason as the link title, which the link component renders as a red span with the reason as tooltip. A citation group gets one link per id in the order written; `[` and `]` in link text are escaped.
  - **Selecting a source opens it and scrolls to it** each time it is clicked; its text stays open until it is closed.

- **Clean code**:
  - **The source's status comes from the backend** (`QuerySource.status`), set after generation, instead of the UI deriving the groups from the draft's lists; E7-3's counts can use it too.
  - **The post-check sorts each reference into a flag or a match in one pass.**
  - **A citation group links each `K:<id>` where it is written** (this also fixes ids such as `K:1` and `K:12` being found inside each other), and a flag carries its reason in the link's title instead of an index into the flags.
  - **The Markdown is parsed once per draft** (`useMemo`), and a click opens and scrolls to its source directly; shared test fixtures in `frontend/src/test-helpers.ts`.
- **Code review fixes**:
  - **A citation group is read as the backend's `findCitations` reads it** (split on commas, `K:` optional after the first id), and an id without a reference stays in the draft as written instead of disappearing.
  - **A chunk the draft names only in free text ("6 § LAS") counts as cited**, both in its status and in the list, since its reference links to it.
  - **The groups come from the status alone**: cited in the order the draft first refers to them, the others in the retriever's order.
  - **A reference link's `href` is its source entry's element id** (`#source-<flow>-<id>`), so a new tab or a copied link finds it, and the two flows' links differ.
  - **The source accuracy is computed from the counts** (`valid × 100 / references`), in the UI and in `npm run query`'s output, since e.g. 0.29 × 100 is 28.999… in floating point.
  - **A reference inside a code span or an existing link is left as written**, so the inserted link cannot break the Markdown.
  - **The page scrolls to a source after it has opened**.
- **Not changed (code review)**:
  - **Sending each chunk's text once in the result**: `approved`, `sources` and the draft's lists repeat it, at most about 200 KB per flow over localhost; the shapes are the ones E6-2 and E7-1 settled.
  - **Importing the backend's types in the frontend**: the backend modules reach Node-only modules the browser build cannot type-check (E7-1's decision).
  - **Moving the document data off the LLM-layer `Chunk`** onto the source: the loader would have to return it separately, and the generator, reranker and judge already ignore it.

## Open Questions

- None.
