---
name: ship-issue
description: Full pipeline for one GitHub issue - spec with questions, owner approval, implement, clean code, code review, verify, PR against develop, PR review, fix review comments, report. Use when the owner says /ship-issue <N> or asks to take an issue all the way to a PR.
argument-hint: <issue number>
---

# Ship an issue end to end

Issue: $ARGUMENTS — if no issue number was given, ask for one before anything else.

Run the steps below **in order**, each by invoking the named skill with the Skill tool. Do not skip, reorder or merge steps. Before each step, tell the owner in one Swedish line which step you are on (e.g. "Steg 4/8: code review").

The **only planned stop is spec approval** in step 1. After approval, run to the end on your own. Stop early and report only if:
- a skill hits its loop cap (the same failure three times),
- something needs a decision the spec does not cover (a new dependency, touching files outside scope, deviating from the spec) — ask with `AskUserQuestion`, then continue,
- anything destructive or irreversible beyond the git rules in `CLAUDE.md` would be needed.

## 0. Preflight

```bash
git fetch origin
gh issue view <N> --json number,title,state,body --jq '{number,title,state}'
```

- The issue must be open.
- Read the issue's `Depends on:` line. For each dependency, check `gh issue view <dep> --json state`. If any dependency is still open, tell the owner which ones and ask whether to continue anyway.
- The working tree must be clean (`git status --porcelain` empty). If not, stop and ask.
- `origin/develop` must exist.

## Steps

1. **Spec** — `spec-from-issue` with the issue number. Continues only once the owner has approved the spec. Produces the branch `feature/<KEY>-<slug>` with the spec committed.

   **Spec already approved:** `/ship-epic` approves specs up front. If `specs/<KEY>-*.md` is on `origin/develop` with Status `Approved`, skip `spec-from-issue` and the approval stop:
   - Move the issue to In Progress.
   - Run `git switch -c feature/<KEY>-<slug> origin/develop`.
   - Compare the spec with what has been merged since it was approved: the Decisions in the dependency specs and the code on `develop`.
     - If something it assumed changed, update the spec, note the change in its Decisions and commit it as `<KEY>: update spec`.
     - If that would change an acceptance criterion, ask the owner first.
   - Continue at step 2.
2. **Implement** — `implement-spec` with the KEY.
3. **Clean code** — `clean-code`.
4. **Code review** — stage everything first so new files are part of the diff (`git add -A`), then invoke the built-in `code-review` skill with args `high`. Fix **every** finding it reports (or, for one you judge wrong, write down why in the spec's Decisions). Re-run the narrowest check that covers each fix.
5. **Verify** — `run-test-and-check-spec` with the KEY. Must end with every acceptance criterion PASS. Do not go on with anything failing or unverified.
6. **PR** — `open-pr` with the KEY.
7. **PR review** — `review-pr` with the PR number.
8. **Address review** — `address-pr-review` with the PR number. Skip if step 7 left no change requests.

## 9. Report (in Swedish)

- PR link and issue link.
- One line per acceptance criterion: PASS and the evidence.
- What the code review and the PR review found, and what was changed.
- Anything unverified, skipped or deliberately left out of scope — plainly.
- Say that the PR is ready for the owner's review and merge into `develop` — or, when run from `/ship-epic`, that `/ship-epic` merges it next.
