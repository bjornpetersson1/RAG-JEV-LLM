---
name: ship-epic
description: Ship a whole epic - write the specs for all its issues first and get them approved in one round, then run every issue through /ship-issue one by one and merge each PR into develop yourself, then open the release PR into main and run /release-check. Use for /ship-epic <epic key, e.g. E2>.
argument-hint: <epic key, e.g. E2>
---

# Ship an epic end to end

Epic: $ARGUMENTS — the epic key, e.g. `E2`. If none was given, ask for one before anything else.

The epic runs in three phases:

1. **Specs.** Write the spec for every issue in the epic, then get them all approved in one round.
2. **Issues.** Run each issue through `/ship-issue` and merge its PR into `develop`.
3. **Release.** Open the release PR from `develop` into `main` and run `/release-check`.

In the end, the owner's only step is merging the release PR into `main`.

Before each step, tell the owner in one Swedish line where you are (e.g. "Specar 2/4: E2-2" or "Issue 3/4: E2-3, steg 5/8: verifiering").

**The only planned stop is the spec approval** in phase 1. After that, run to the end on your own. Stop and report only if:

- a skill hits its loop cap (the same failure three times),
- something needs a decision the specs do not cover — ask with `AskUserQuestion`, then continue,
- a merge precondition in the merge step fails,
- anything destructive or irreversible beyond the git rules in `CLAUDE.md` would be needed.

If one issue cannot be finished, stop the whole epic. Later issues may build on it. Report what was merged, what was not, and why.

**Merging.** This skill merges into `develop`:

- the spec PR,
- each issue's PR.

`/release-check` merges its own fix PR. These are the exceptions to the no-merge rule in `CLAUDE.md`. Nothing is ever merged into `main`, and nothing is pushed directly to `develop` or `main`.

## 0. Preflight

```bash
git fetch origin
gh issue list --label "<label>" --state all --limit 100 --json number,title,state,body
```

- **Find the label.** It is the one starting with the epic key, e.g. `E2 Data ingestion` (`gh label list`).
- **Find the issues.** They are the label's issues; the KEY is the start of each title, e.g. `E2-1`.
  - If any issue is already closed, leave it out and say so.
  - If none is open, stop.
- **Order the issues.** Order them by their `Depends on:` lines (dependencies first), then by KEY.
  - Every dependency outside the epic must be closed. Otherwise tell the owner which ones are open and ask whether to continue.
- **Check the working tree.** It must be clean (`git status --porcelain` empty), and `origin/develop` must exist.
- **Check for an open release PR.** If a PR from `develop` into `main` is already open, ask the owner first. It would pick up this epic's merges.

## Phase 1 — Specs

### 1.1 Write the specs, in issue order

For each issue, invoke `spec-from-issue` with `<N> batch`. In batch mode it asks its questions and writes the spec as a Draft, but skips approval, branching and committing.

- The specs from this run count as dependency specs. When a later issue depends on an earlier one, its spec builds on the earlier spec's decisions instead of asking the same questions again.
- Questions go to the owner as they come up, issue by issue.

### 1.2 Approve them all in one round

Give the owner one short Swedish summary per spec:

- the path,
- the number of acceptance criteria,
- the main decisions,
- what it builds on from earlier specs.

Then ask with `AskUserQuestion`: one question per spec, "Godkänner du specen för <KEY>?", with the options **Godkänn** / **Ändra** (details in the free-text answer). At most 4 questions per call.

- For every **Ändra**, edit that spec. Also update the later specs that build on the change.
- Ask again about every spec you edited.
- Do not continue until every spec is approved.

### 1.3 Merge the specs into develop

```bash
git switch -c feature/<EPIC>-specs origin/develop
```

- Set **Status:** `Approved` in every spec.
- Commit them as `<EPIC>: add specs` (Co-Authored-By trailer from `CLAUDE.md`) and push.
- Open a PR against `develop` with:
  - title `<EPIC> · specs`;
  - a body with one line per spec and the issue it belongs to (`Refs #N`, not `Closes`);
  - the Claude Code line at the end.
- Merge it as described in the merge step below.

## Phase 2 — Issues, one at a time, in order

For each issue:

1. **Start from the latest develop.**
   ```bash
   git switch develop && git pull --ff-only
   ```
2. **Ship it.** Invoke `ship-issue` with the issue number.
   - Its spec is already approved on `develop`, so it skips the spec step and branches from `origin/develop`.
   - Before implementing, it checks the spec against what the earlier issues actually delivered.
   - It then runs through the PR review and its fixes.
3. **Merge** the issue's PR (merge step below).
4. **Move the issue to Done:** `.claude/scripts/set-issue-status.sh <N> "Done"`. The `Closes #N` in the PR closes the issue itself.

### Merge step (spec PR and issue PRs)

1. `git fetch origin`. The PR must be open with base `develop`, and its head must be the pushed branch tip (`git rev-parse HEAD` = `headRefOid`).
2. Run:
   ```bash
   gh pr view <PR> --json mergeable,statusCheckRollup,reviewDecision
   ```
   - It must be `MERGEABLE`.
   - No check may be failing or pending.
   - For an issue PR, every review thread must be resolved (the `reviewThreads` query in `address-pr-review`).
3. If any of this fails, stop and report.
4. Merge with a merge commit, like the earlier PRs, and keep the branch:
   ```bash
   gh pr merge <PR> --merge
   ```
5. `git switch develop && git pull --ff-only`.

## Phase 3 — Release

1. **Open the release PR**, with an empty body (`/release-check` writes the description):
   ```bash
   gh pr create --base main --head develop --title "<label, e.g. E2 Data ingestion>" --body ""
   ```
2. **Run the check.** Invoke `release-check` with the release PR number. It verifies the release, fixes what it can, merges its fix PR into `develop` and reviews the release PR.

## Report (in Swedish)

- **Release PR link and verdict** from `/release-check`.
- **One line per issue:**
  - PR link,
  - merged or not,
  - what the code review and the PR review found,
  - anything unverified or left out of scope, plainly.
- **Spec changes made during implementation**, and why.
- **Open findings from `/release-check`** that need the owner's decision.
- **What the owner does next:** merge the release PR into `main` — or, if the verdict is blocked, what has to be decided first.
