---
name: clean-code
description: Clean-code pass over the uncommitted changes (or the branch diff against develop) without changing behaviour. Use for /clean-code, as step 3 of /ship-issue and after fixing PR review comments.
argument-hint: <optional path or KEY>
---

# Clean-code pass

Scope: the changes on this branch — `git diff origin/develop...` plus uncommitted and untracked files (`git status --porcelain`). Do not touch code outside that diff. Behaviour must not change.

## 1. Built-in simplification

Stage everything so new files are part of the diff (`git add -A`), then invoke the built-in `simplify` skill and let it apply its fixes.

## 2. Project checklist

Then go through the changed files once more against this list and fix what you find:

- **Names** say what things are; no abbreviations other than domain terms (SFS, AD, NDA, JEV, FTS).
- **Functions** do one thing; split anything that needs a comment to explain its sections. Prefer early returns over nesting.
- **No duplication** — reuse existing helpers and types in the repo before adding new ones.
- **Types**: no `any`, no unnecessary type assertions; shared shapes defined once.
- **Boundaries**: LLM/JEV calls only through the role interfaces; config only through the config loader; no secrets or magic numbers in code (thresholds, limits, timeouts come from config).
- **Errors** are handled where they can be acted on, with a useful message; no swallowed errors.
- **Dead weight**: no unused exports, imports, files, debug logging or commented-out code.
- **Comments** explain *why*, not *what*; delete ones that restate the code.
- **Tests** are readable: clear names, arrange/act/assert, no logic copied from the implementation.

## 3. Check and report

Run `npm run lint`, `npm run format` and `npm run typecheck` (if they exist) once at the end, plus the test files for the code you changed. Do not run the full suite. Summarise in a few lines what you changed and why. Leave changes uncommitted.
