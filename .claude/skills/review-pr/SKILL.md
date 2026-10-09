---
name: review-pr
description: Review an open pull request against its spec and issue and post a GitHub review with inline comments on what must change. Use for /review-pr <PR number> or as step 7 of /ship-issue.
argument-hint: <PR number — optional, defaults to the current branch's PR>
---

# Review the PR

PR: $ARGUMENTS — if none was given, use `gh pr view --json number` for the current branch.

Review as a strict senior reviewer who did **not** write the code. The local code review already hunted for bugs; this review is about whether the PR is the right change, done well enough to merge.

## 1. Gather

In one round:

```bash
gh pr view <PR> --json number,title,body,headRefName,headRefOid,baseRefName,files,url
gh pr diff <PR>
```

Read the spec (`specs/<KEY>-….md`) and the issue (`Closes #N`). Read full files only where the diff alone is not enough to judge.

## 2. Review against

1. **Spec and issue conformance** — every acceptance criterion is actually met by the code (not only claimed in the PR text); nothing in Non-goals was built; no unrequested scope.
2. **Tests** — each criterion has a test or a stated proof; tests would fail if the feature broke; no network in tests; edge cases from the spec are covered.
3. **Design** — fits the architecture in `CLAUDE.md` (role interfaces, config loader, SQLite, local-only); sensible module boundaries; ready for the issues that depend on this one (check their issue text for what they will need).
4. **Clean code** — the `/clean-code` checklist.
5. **Hygiene** — README / `.env.example` updated, no secrets, no stray files, clear commit messages, PR text accurate.

Only comment on things that should change before merge. Each comment states what is wrong, why it matters, and what to do instead. Mark minor ones `nit:`. Do not pad the review.

## 3. Post the review

Build a JSON payload in the scratchpad and post one review with `event: "COMMENT"` (the owner's account cannot request changes on its own PR):

```json
{
  "commit_id": "<headRefOid>",
  "event": "COMMENT",
  "body": "<summary: overall verdict, number of comments, anything not tied to a line>",
  "comments": [
    { "path": "src/x.ts", "line": 42, "side": "RIGHT", "body": "..." }
  ]
}
```

```bash
gh api repos/bjornpetersson1/RAG-JEV-LLM/pulls/<PR>/reviews --method POST --input <file>
```

`line` must be a line in the diff on the right side; for a comment on unchanged code, put it in the body instead. If there is nothing to change, post a review with no inline comments saying so, and report that `/address-pr-review` can be skipped.

## 4. Report

The review URL and the comments, one line each.
