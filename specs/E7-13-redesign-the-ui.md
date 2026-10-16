# E7-13 · Redesign the UI

- **Issue:** [#105](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/105)
- **Labels:** `E7 UI and measurement`
- **Phase:** E7 UI and measurement
- **Depends on:** none (related: E7-1 (#22), E7-2 (#23), E7-3 (#24), E7-11 (#98), E7-12 (#103))
- **Status:** Implemented — all acceptance criteria verified (lint, format:check, typecheck, 936 backend + 109 frontend tests and build exit 0; scrollWidth 375 on every view at 375 px)

## Summary

Give the whole UI a designed look in the spirit of the owner's reference image, a retro-modern flat poster illustration (cream paper, warm orange, burnt red, salmon and mustard, near-black outlines, simple geometric shapes, light print grain). The data stays in focus: clear, airy and modern. Appearance only; behaviour, data and Swedish copy do not change.

## Goals

- One design system in CSS: tokens for colour, type, spacing, radii, borders and shadows on `:root`.
- Every view restyled: form, flow progress, result view (sources, draft, references, post-check), timing panel, info texts, _Tidigare körningar_ (list and detail).
- The retro style lives in the frame (header, cards, buttons, tabs, accents); the data (tables, numbers, sources, draft) gets high contrast, generous whitespace and a clear hierarchy.
- Accessible and responsive.

## Non-goals

- No change in behaviour, API, data or UI text. The Swedish copy stays word for word.
- No dark mode (owner decision); the tokens make it possible later.
- No CSS framework, CSS-in-JS or component library.
- No new UI features (e.g. the source filter of E7-12 #103 is not built here).
- No automated visual regression testing.

## Acceptance Criteria

1. **All colours, font sizes and spacing come from tokens on `:root`; no stray hex values in the component styles.**
   - `frontend/src/styles.css` (and any new stylesheet) defines colour, font-size, spacing, radius, border and shadow tokens as custom properties on `:root`.
   - Outside the `:root` token block, no hex, `rgb()`/`hsl()` colour literal and no `px`/`rem` font size appears; a grep over the stylesheets proves it (the decorative SVG/grain data URI is the only allowed exception and is itself built from token colours or documented in a comment).
2. **Every view listed in Goals is restyled, shown by before/after screenshots.**
   - Before and after screenshots of: the form, a running flow, a finished result (sources, draft, timing panel with an opened info text) and _Tidigare körningar_ (list and one run's detail), at desktop width and at 375 px.
   - Saved under `docs/screenshots/E7-13/` (`before-*.png`, `after-*.png`) and linked in the PR.
3. **Body text and data meet WCAG AA contrast against their background.**
   - Every text/background token pair used for text has a contrast ratio ≥ 4.5:1 (≥ 3:1 for large text ≥ 24 px or bold ≥ 18.66 px, and for focus rings and UI borders that carry meaning).
   - The ratios are listed in a comment next to the tokens and checked by a small unit test that computes them from the token values.
4. **No horizontal page scroll at 375 px width.**
   - At 375 px the document is not wider than the viewport on any view in criterion 2; wide tables scroll inside their own container.
   - Proven by the 375 px screenshots and a check of `document.documentElement.scrollWidth <= 375` in the browser.
5. **Fonts load without network access at runtime.**
   - Fraunces (headings) and Inter (body, data) come from local `@fontsource` packages bundled by Vite; no `<link>` or `@import` to a remote font host.
   - `npm run build` output contains the font files; a grep of `frontend/` for `fonts.googleapis`/`fonts.gstatic` finds nothing.
6. **Visible focus and no information by colour alone.**
   - Every interactive element (inputs, radio buttons, buttons, links, run rows, (i) buttons, source summaries) has a visible `:focus-visible` style.
   - States that today differ only by colour (tag origin, flagged reference, highlighted source, time-to-sources bar) also differ by another cue (label, icon, underline, border or pattern) — existing text labels count.
7. **All existing frontend tests pass unchanged in intent; `npm test` runs without network access.**
   - No test is deleted, skipped or weakened. A test may only change where it asserted a class name or markup that the redesign renamed, and then asserts the same behaviour.
   - The canonical checks pass: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.

## Tasks

- [x] Take the before screenshots (desktop and 375 px) with faked responses.
- [x] Add `@fontsource-variable/fraunces` and `@fontsource-variable/inter` to `frontend` and import them in `main.tsx`.
- [x] Define the tokens on `:root`: palette (cream background, paper surface, near-black ink, muted ink, orange/burnt-red accent, mustard, salmon, error and success colours that fit the palette), type scale, spacing scale, radii, outline widths, shadows.
- [x] Global base: body background with light grain, typography (Fraunces for headings, Inter with tabular figures for body and numbers), links, focus ring, buttons, inputs, radio buttons, textarea.
- [x] Header: app title with a geometric motif (arch, circle, stripes) drawn in CSS or inline SVG from token colours; the view tabs (_Ny förfrågan_ / _Tidigare körningar_) styled as tabs.
- [x] Cards: thick dark outline, flat offset shadow, generous padding, used for form, flow, result, timing panel and runs.
- [x] Restyle each view: form, flow progress and tags, result (draft, disclaimer, references, flagged references, post-check), source list, timing panel (table, bars, totals, comparison, configuration), info buttons and texts, runs list, filters, paging and run detail.
- [x] Layout: wider main column where tables need it, consistent spacing, table containers with `overflow-x: auto`, works at 375 px.
- [x] Contrast unit test over the token values.
- [x] Take the after screenshots and save both sets under `docs/screenshots/E7-13/`.
- [x] Update a test only where it asserted a renamed class or markup (none needed: every existing test passes unchanged).

## Decisions

- **Fonts: Fraunces for headings, Inter for body and data** (owner). Fraunces is a soft retro serif that matches the reference; Inter is highly readable and has tabular figures for timings and counts. Self-hosted through the variable `@fontsource` packages so nothing is fetched at runtime. This adds two frontend dependencies, accepted with the font choice.
- **Decoration: moderate** (owner). A geometric header motif, thick dark outlines on cards and buttons and light print grain on the page background. Nothing decorative inside tables, sources or the draft.
- **No dark mode** (owner). The reference is built on cream paper; the tokens leave the door open.
- **Screenshots taken by Claude in the browser and committed under `docs/screenshots/E7-13/`** (owner), not with a new tool such as Playwright.
- **Markup changes are allowed only where styling needs them** (a header element, wrappers for scrollable tables, an icon or label for a colour-only state), never in text or behaviour. Default chosen so the redesign is not limited to what the current markup allows.
- **Contrast is checked by a unit test**, which makes criterion 3 objectively checkable instead of by eye. Sharpens the issue's criterion.
- **The issue's "no stray hex values" is read as no colour literals or font sizes outside the token block**, the decorative data URI excepted. Sharpens the issue's criterion.
- **Accessibility criteria for focus and colour-only states** are split into their own criterion (6), from the issue's Scope.
- **Tokens live in their own `frontend/src/tokens.css`**, imported before `styles.css`, so "outside the token block" is simply "in `styles.css`" and the test can check that file whole. The grain data URI is a token too (`--grain`), so `styles.css` needs no exception.
- **Fraunces is loaded with its `soft` axes** (`@fontsource-variable/fraunces/soft.css`: weight and `SOFT`) for the soft retro shape of the headings. `full.css` would add `WONK` and `opsz` for 121 KB against 62 KB (clean-code pass); Inter with its default weight axis.
- **Cards share one `card` class** whose padding, border and shadow are CSS variables: a card inside a card (a run's detail) and phone width change the variables, not a list of section selectors (clean-code pass).
- **The header motif is an inline SVG component (`Motif.tsx`)** coloured by CSS classes from the tokens, `aria-hidden`.
- **Orange and mustard are fills only** (contrast 2.8 and 1.8 on surface), always inside an ink outline; the bars get an ink border for 3:1. The time-to-sources bar is striped as well as coloured, the highlighted source gets an accent bar on its left, and the selected contract type is bold as well as tinted.
- **The draft keeps line breaks inside paragraphs but no longer `pre-wrap`s the whole article**, which drew empty lines between Markdown blocks. Only `p` keeps `pre-wrap`: react-markdown puts newlines between the blocks of a list item, so `pre-wrap` on `li` would bring the empty lines back (code review). A soft line break inside a tight list item now shows as a space. Appearance only.
- **The timing table has a minimum width of 30rem and scrolls inside `.table-scroll` on a phone.** The counts table needs no scroll container: it is fixed-layout at 100% and its labels wrap instead of running into the values (code review).
- **The contrast and literal test runs in Vitest's node environment** (`// @vitest-environment node`) and reads the files with `node:fs`: in jsdom, `?raw` CSS imports come back empty, which would let the test pass without checking anything.
- **Screenshots were taken with headless Chrome over the DevTools protocol** from a script kept outside the repo, against the app on its own ports with every LLM role `fake`, `RERANKER=llm` and `JUDGE_THRESHOLD=0.1` (so the fake judge passes some sources and a draft shows). No paid call was made; the fake runs were removed from `logs/runs.jsonl` afterwards. The before shots show the old layout overflowing at 375 px (431 and 448 px); the after shots stay at 375 px.
- **Code review fixes:** border and focus-ring widths are tokens too (`--outline-hairline` to `--outline-heavy`, `--outline-focus`) and the literals test checks them, together with spacing; the grain sits on `:root`, so it covers the whole canvas; an opened (i) keeps its fill on hover; the source groups' h3 keep body size (`.flow > h3`); no status dot on the backend pill, since it showed the same colour whatever the status; no italic on the (i) and the pending text, since only upright font files are bundled; ink-muted on mustard-soft is a tested pair.

## Open Questions

- None.
