---
name: implement-spec
description: Implement an approved spec from specs/ on its feature branch, with the narrowest checks while building. Use for /implement-spec <KEY> or as step 2 of /ship-issue.
argument-hint: <spec key, e.g. E1-1>
---

# Implement a spec

Spec: $ARGUMENTS — if none was given, list `specs/` and ask which one.

## 1. Read before you build

In one parallel batch read: the spec, `CLAUDE.md`, the specs it depends on, and only the existing files the spec touches. The spec is the scope.

Check you are on `feature/<KEY>-…` and that the spec's Status is `Approved`. If not, stop and say so.

## 2. Resolve open questions first

If **Open Questions** is non-empty, answer it with `AskUserQuestion` before writing code. Also ask, at any point, before you:
- add a dependency the spec does not name,
- touch files outside the spec's scope,
- deviate from the spec in any way,
- do anything destructive or hard to reverse.

If you catch yourself writing "I'll assume…", ask instead. Record every answer in Decisions.

## 3. Plan

One task per acceptance criterion (or coherent group), plus a final task: *write tests that prove each criterion*. Mark tasks in progress / done as you go.

## 4. Implement

- Tests are part of the work: every acceptance criterion that can be proved by a test gets one. Tests run without network access (use the fakes).
- Batch all dependency installs into one command, then check what was actually written to `package.json`.
- Use library APIs as installed — when unsure of an API, read its types in `node_modules` rather than relying on memory.
- Match the surrounding code's style, naming and comment density. Small, well-named functions; no dead code, no commented-out code, no stray `console.log`.
- Make independent edits in parallel; never re-read a file just to confirm an edit landed.
- While building, run only the narrowest checks (one test file, `npm run typecheck`). The full suite is `/run-test-and-check-spec`'s job.
- Keep `.env.example` and the README up to date with anything the spec adds (keys, commands).

## 5. Update the spec and stop

- Tick the Tasks that are done; add anything settled while implementing to Decisions.
- Set **Status:** `Implemented — pending verification`.
- Leave changes uncommitted. Summarise what was built, what you assumed, and what you deliberately left out of scope.
