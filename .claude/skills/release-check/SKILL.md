---
name: release-check
description: Check a release pull request from develop into main when an epic is done - verify the whole release, run clean code over all of it, fix what is wrong on a fix branch, and post a review on the release PR. Use for /release-check <PR number> whenever an epic is finished and develop is about to be merged into main.
argument-hint: <release PR number — optional, defaults to the open PR from develop into main>
---

# Release check: develop → main

Release PR: $ARGUMENTS — if none was given, find the open PR with base `main` and head `develop` (`gh pr list --base main --head develop --state open`). If there is none, or more than one, stop and ask.

Every feature PR has already had its own spec, code review and PR review. This check looks at the **release as a whole**:

- Does everything still work together?
- Is the epic actually done?
- Is the code clean across issues, not just within each one?
- Is the release ready for `main`?

The owner merges; you never push to `develop` or `main`.

## 0. Preflight

```bash
git fetch origin
gh pr view <PR> --json number,title,state,baseRefName,headRefName,headRefOid,body,url
```

- The PR must be open, with base `main` and head `develop`.
- Work in a separate git worktree, so the owner's checkout is never switched or touched. Put it in the scratchpad if one is available, otherwise in a temporary directory:
  ```bash
  git worktree add --no-track -b feature/<EPIC>-release-check <scratchpad>/wt-release origin/develop
  ```
  `<EPIC>` is the epic key, e.g. `E1` (see step 1). Run every later command inside the worktree, and `npm ci` there first.

## 1. Gather

- **The epic.** Take it from the PR title, or from the issue keys in `git log --oneline origin/main..origin/develop` (e.g. `E1-1`, `E1-2` → epic `E1`). If the release spans more than one epic, check each one.
- **Its issues.** Every issue with the epic's label, e.g. `E1 Foundation`:
  ```bash
  gh issue list --label "<label>" --state all --json number,title,state
  ```
- **The specs** in `specs/` for those issues, and the epic's "Done when" lines in `Constitution/Requirements-and-goal.md`.
  - Also read the phase row in the delivery-plan table if this epic completes a phase.
- **The release diff**, ignoring the lockfile:
  ```bash
  git diff --stat origin/main...origin/develop
  git diff origin/main...origin/develop -- . ':!package-lock.json'
  ```

## 2. Verify the release (on the worktree, before any change)

1. **Full checks**, offline:
   ```bash
   npm ci && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
   ```
   On macOS, run `npm test` under `sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip))'` with `ANTHROPIC_API_KEY` unset, to prove it needs no network.
2. **Fresh-clone path.** Follow the README's Getting started on the worktree, with a `.env` copied from `.env.example` and edited only as the README tells you. Every documented command must work:
   - `npm run dev`: the backend answers `/health` and the frontend page loads.
   - Any `db:*` or `data:*` command, pointed at a temporary path.

   Stop every process you start.
3. **Issues and specs.**
   - Every issue of the epic is closed, or its PR is merged into `develop`.
   - Every spec's Status says all acceptance criteria are verified.
   - Each spec's acceptance criteria still hold on `develop`. A later issue may have broken an earlier one.
4. **Epic "Done when".** Prove each line from the requirements with a command or a named test.
5. **Hygiene.**
   - No secrets in the diff (`grep -nE 'sk-ant-|api[_-]?key\s*=\s*\S'`), and no `.env`, databases, logs or build output tracked.
   - `npm audit --omit=dev` shows no high or critical issues.
   - `.env.example` documents every key the code reads (grep for `process.env`).

Record each item as PASS or FAIL with its evidence.

## 3. Clean code over the whole release

Invoke `clean-code` with the argument `base origin/main`, so its scope is the whole release (`git diff origin/main...`), not one issue.

- Code files only: skip `package-lock.json`, `specs/`, `Constitution/` and `.claude/`.
- The built-in `simplify` reviews the diff of the directory it runs in. Run it from the worktree; if it would look at the owner's checkout instead, do its review by hand over the release diff.
- Look especially for what a single-issue review cannot see: the same helper written twice in different issues, inconsistent config or error-handling patterns, naming that drifted between issues, and dead code an earlier issue left behind.

## 4. Review the release

Read the release diff as a strict senior reviewer who did not write it. Check:

1. **Docs**: README, `.env.example` and `CLAUDE.md` describe the code as it is now; nothing describes a state an earlier issue had.
2. **Specs**: Decisions that a later issue overrode are marked as superseded, not left contradicting the code.
3. **Architecture**: the constraints in `CLAUDE.md` hold:
   - one interface per LLM role,
   - config only through the config loaders,
   - SQLite only,
   - everything local except LLM/JEV calls.
4. **Readiness**: the next epic's issues (read their text) can build on this without reworking it.

## 5. Fix

Fix every FAIL from steps 2–4 that has a clear fix, on the worktree branch `feature/<EPIC>-release-check`.

- **Ask the owner** with `AskUserQuestion` before:
  - changing behaviour,
  - adding a dependency,
  - changing an acceptance criterion,
  - making a fix larger than a small, local change.
- Things that need a decision are reported, not fixed.
- After the fixes, run the full checks from step 2.1 again; all must pass.
- Commit as `<EPIC>: <imperative summary>`, with a body listing the fixes and the Co-Authored-By trailer from `CLAUDE.md`.
- Push and open a PR **against `develop`** with title `<EPIC> · release-check fixes`. Its body lists each fix and the verification, and ends with the Claude Code line.

If nothing needs fixing, skip this step and delete the empty branch.

## 6. Comment on the release PR

Post one review on the release PR with `event: "COMMENT"` (the owner cannot request changes on their own PR), through `gh api repos/<owner>/<repo>/pulls/<PR>/reviews --method POST --input <file>`. Build the JSON payload in the scratchpad.

- **Body**: verdict (ready to merge, ready after the fix PR, or blocked), the epic's "Done when" lines with PASS/FAIL, and the fix PR link.
- **Inline comments**: one per finding, on a line of the release diff:
  - for a fixed finding, what was wrong and "fixed in #<fix PR>";
  - for an open finding, what is wrong, why it matters and what to do.

  Mark minor ones `nit:`.
- **Release PR description**: if it is empty or only a title, write one with `gh pr edit <PR> --body-file <file>`. Include:
  - the epic and its issues;
  - what the release delivers (one line per issue);
  - how it was verified;
  - the merge order (fix PR into `develop` first, then this PR);
  - the Claude Code line.

## 7. Report to the owner (in Swedish)

- Release PR link, and the fix PR link if there is one.
- One line per check from step 2 and per "Done when" line: PASS or FAIL and the evidence.
- What clean code and the review found; what was fixed and what is left for the owner.
- What the owner does next:
  1. Merge the fix PR into `develop`.
  2. Check that the release PR updated.
  3. Merge it into `main`.
  4. Move any epic issue not yet `Done` on the board (`.claude/scripts/set-issue-status.sh`).
- Anything unverified, plainly.
- Remove the worktree when done (`git worktree remove <path>`), keeping the branch.
