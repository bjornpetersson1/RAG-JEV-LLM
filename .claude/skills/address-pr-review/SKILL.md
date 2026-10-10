---
name: address-pr-review
description: Work through the unresolved review comments on a pull request - fix each one, run clean code and the full verification, push, then reply to and resolve every thread. Use for /address-pr-review <PR number> or as step 8 of /ship-issue.
argument-hint: <PR number — optional, defaults to the current branch's PR>
---

# Address PR review comments

PR: $ARGUMENTS — if none was given, use the current branch's PR.

## 1. Collect unresolved threads

```bash
gh api graphql -f query='query($n:Int!){repository(owner:"bjornpetersson1",name:"RAG-JEV-LLM"){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path line comments(first:20){nodes{databaseId author{login} body}}}}}}}' -F n=<PR>
```

Also read the review summary bodies (`gh pr view <PR> --json reviews`) for points not tied to a line. Make sure the local branch matches the PR head (`git pull --ff-only`).

## 2. Fix

Go through every unresolved thread and summary point. For each, either fix it, or — if you judge it wrong — decide not to change it and prepare a reply explaining why. Ask the owner with `AskUserQuestion` only if a comment would change the spec's scope or acceptance criteria.

## 3. Clean code and verify

- Invoke `clean-code`.
- Invoke `run-test-and-check-spec` with the KEY — everything must be PASS again. Update the spec's Decisions with anything the review changed.

## 4. Commit and push

One commit per coherent fix, or one `<KEY>: address review comments` commit with a body listing the fixes, with the Co-Authored-By trailer. `git push` (never force).

## 5. Reply and resolve

For each thread, reply with what was done and the commit hash:

```bash
gh api repos/bjornpetersson1/RAG-JEV-LLM/pulls/<PR>/comments/<first comment databaseId>/replies --method POST -f body="Fixed in <sha>: <what changed>"
gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<thread id>
```

Resolve only threads that were actually fixed. Leave declined ones open with the explanation, so the owner decides. Update the PR body's Verification section if the numbers changed (`gh pr edit <PR> --body-file <file>`).

## 6. Report

One line per thread: fixed (sha) or declined (why), plus the verification result.
