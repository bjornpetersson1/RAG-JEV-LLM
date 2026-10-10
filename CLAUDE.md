# Legal RAG POC (RAG-JEV-LLM)

Proof of concept: tag-based search + the JEV judge model find relevant Swedish laws and rulings, and an LLM drafts employment agreements and NDAs from them. The requirements live in `Constitution/Requirements-and-goal.md`; every piece of work is a GitHub issue (#1–#24) on the project board "Legal RAG POC" (https://github.com/users/bjornpetersson1/projects/4).

## Language

- Talk to the owner in **Swedish**.
- Everything committed or posted is in **English**: code, comments, specs, commit messages, PR text, review comments.

## Workflow

Work is done issue by issue with `/ship-issue <issue number>`, which chains these skills:

1. `/spec-from-issue` – questions → spec in `specs/` → **owner approval** (the only planned stop)
2. `/implement-spec`
3. `/clean-code`
4. built-in `/code-review` (fix every finding)
5. `/run-test-and-check-spec`
6. `/open-pr` – commit, push, PR against `develop`
7. `/review-pr` – inline review comments on the PR
8. `/address-pr-review` – fix, clean code, verify, push, reply and resolve
9. Report to the owner, who reviews and merges.

Each skill can also be run on its own.

When an epic is done and `develop` is ready for `main`, run `/release-check <release PR number>`. It verifies the whole release, runs clean code over it, fixes what is wrong on a `feature/<EPIC>-release-check` branch, merges that fix PR into `develop` and posts a review on the release PR. The owner's only step is merging the release PR into `main`.

## Git and GitHub rules

- `develop` is the integration branch; `main` is only updated by the owner. PRs always target `develop`.
- Branch per issue: `feature/<KEY>-<slug>`, e.g. `feature/E1-1-repo-and-skeleton`, created from `origin/develop`.
- Never push to `develop` or `main`, never merge, never force-push, never rewrite pushed history. The one exception: `/release-check` merges its own fix PR into `develop`.
- Commit messages: `<KEY>: <imperative summary>`, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Move issues on the board with `.claude/scripts/set-issue-status.sh <issue> "<Todo|In Progress|In Review|Done>"`.

## Verification

The canonical checks (defined by E1-1) are run from the repo root:

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

- Tests must run without network access (LLM and JEV are faked in tests).
- Outside `/implement-spec` and `/run-test-and-check-spec`, run the narrowest check that answers the question (one test file, `npm run typecheck`), not the whole suite.
- Never weaken an acceptance criterion, skip or delete a test to get to green.

## Constraints from the requirements

- Everything except LLM/JEV calls runs locally. SQLite for storage, no hosted services.
- One interface per LLM role (Tagger, QueryTranslator, Judge, Generator); provider and model come from `.env`.
- API keys only in `.env` (git-ignored); document every key in `.env.example`.
