---
name: open-pr
description: Commit the verified work, push the feature branch and open a pull request against develop, then move the issue to In Review. Use for /open-pr <KEY> or as step 6 of /ship-issue. Only after /run-test-and-check-spec has passed.
argument-hint: <spec key, e.g. E1-1 — optional>
---

# Commit, push and open the PR

Spec: $ARGUMENTS — if none was given, infer it from the branch name and say which one you picked.

## 1. Preconditions

- On `feature/<KEY>-…`, never on `develop` or `main`.
- The spec's Status says all acceptance criteria are verified. If not, stop: run `/run-test-and-check-spec` first.
- `git status --porcelain`: everything listed belongs in the PR. No `.env`, databases, logs or build output — fix `.gitignore` if needed.

## 2. Commit

Stage explicitly (`git add -A` after checking the list above) and commit with `<KEY>: <imperative summary of what was delivered>`, a short body listing the main pieces, and the Co-Authored-By trailer from `CLAUDE.md`. If the work is naturally separable (e.g. tooling vs feature), up to three commits is fine.

## 3. Push

```bash
git push -u origin HEAD
```

Never force-push.

## 4. Write the PR text

Gather what changed: `git log --oneline origin/develop..HEAD` and `git diff --stat origin/develop...HEAD`, plus the spec.

Write to a scratchpad file (not the repo):

- **Title:** `<KEY> · <what it delivers>`, no trailing full stop.
- **Body:**
  - `Closes #N` on its own line.
  - `Spec: specs/<file>.md`.
  - One `##` section per coherent piece of work, in the order a reviewer meets them. Plain prose, bullets only for real lists.
  - `## Acceptance criteria` — each criterion with ✅ and how it was proved.
  - `## Verification` — the commands run and their results, with numbers (e.g. "42 tests passed"). Anything unverified, skipped or left to the owner in **bold**, plainly.
  - End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Plain English, no marketing, no "This PR…" preamble.

## 5. Create the PR and move the issue

```bash
gh pr create --base develop --head <branch> --title "<title>" --body-file <file>
.claude/scripts/set-issue-status.sh <N> "In Review"
```

Report the PR URL.
