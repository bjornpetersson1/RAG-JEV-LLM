---
name: spec-from-issue
description: Turn a GitHub issue into an implementation spec under specs/ by asking the owner structured questions, get the spec approved, then create the feature branch and commit the spec. Use for /spec-from-issue <N> or as step 1 of /ship-issue.
argument-hint: <issue number> [batch]
---

# GitHub issue → approved spec

Issue: $ARGUMENTS — if none was given, ask for one first.

**Batch mode** (argument `batch`, used by `/ship-epic`): run steps 1–3 only.
- Do not move the issue's status.
- Leave the spec uncommitted with Status `Draft`.
- `/ship-epic` approves all of the epic's specs together and commits them.

## 1. Gather context (cheaply)

```bash
gh issue view <N> --json number,title,body,labels,state,url,comments
```

Comments matter — decisions often live there. Then, in one parallel batch, read:
- the specs of the issues listed under `Depends on:` (in `specs/`), if they exist,
- the parts of `Constitution/Requirements-and-goal.md` the issue refers to,
- only the existing code the issue touches.

Do not tour the repo or spawn subagents. Move the issue to In Progress:

```bash
.claude/scripts/set-issue-status.sh <N> "In Progress"
```

## 2. Ask before you write — the most important step

Start from the issue's **Open questions for the spec**, then add every assumption you would otherwise have to invent: anything that would change acceptance criteria, file layout, a dependency or tool choice, data shape or visible behaviour. Always ask when the issue conflicts with the repo, names a capability without naming the tool, has a criterion that is not objectively checkable, or has unclear scope.

- Use `AskUserQuestion`, at most 4 questions per call, **at most 8 questions in total**. Batch related questions. Put the recommended option first, labelled `(Recommended)`, with a one-line reason.
- If there are more than 8 candidates, ask the 8 that matter most and settle the rest with conventional defaults, stating each one in Decisions.
- Prefer no new dependency when a reasonable built-in way exists.

## 3. Write the spec

Path: `specs/<KEY>-<kebab-slug>.md`. `<KEY>` is the identifier at the start of the issue title (e.g. `E1-1`); the slug is the rest of the title, kebab-cased.

```markdown
# <KEY> · <Title>

- **Issue:** [#N](<url>)
- **Labels:** `label`
- **Phase:** <phase from the issue>
- **Depends on:** <KEY (#N), … or none>
- **Status:** Draft

## Summary
One or two sentences: what this delivers and why.

## Goals

## Non-goals
Including adjacent things a reader would reasonably assume are included.

## Acceptance Criteria
1. **<Criterion from the issue, verbatim where possible>**
   - Concrete, independently verifiable sub-conditions.
   - The command or test that proves it (e.g. "`npm test` passes with no network access").

## Tasks
- [ ] The issue's scope as tasks, plus any the criteria imply.

## Decisions
- Each question asked or default chosen: what was chosen and **why**. Note where it departs from the issue.

## Open Questions
- Only genuinely unresolved items (should normally be empty).
```

Rules: every criterion objectively verifiable; do not expand scope (extra things go in Non-goals); keep the issue's intent while sharpening vague criteria; no implementation walkthroughs or code.

## 4. Approval — the gate

Give the owner a short Swedish summary (path, number of criteria, the main decisions), then ask with `AskUserQuestion`: "Godkänner du specen?" with options **Godkänn** / **Ändra** (details in the free-text answer). On changes, edit the spec and ask again. Do not continue until the answer is Godkänn.

## 5. Branch and commit

```bash
git fetch origin
git switch -c feature/<KEY>-<slug> origin/develop
```

Set **Status:** `Approved` in the spec, then commit only the spec: `<KEY>: add spec` (with the Co-Authored-By trailer from `CLAUDE.md`). Do not push.

Economy: one `gh` call, one batched read, question rounds as needed (max 8 questions), one write.
