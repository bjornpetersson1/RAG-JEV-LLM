# E1-1 · Repo and skeleton

- **Issue:** [#1](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/1)
- **Labels:** `E1 Foundation`
- **Phase:** 1. Foundation
- **Depends on:** none
- **Status:** Approved

## Summary
A single npm-workspaces repository with a Node + TypeScript backend (Fastify, `/health`) and a React + Vite + TypeScript frontend that shows the backend health status, with one root command each for dev, lint, format check, typecheck, test and build. Every later issue builds on this skeleton.

## Goals
- `backend/` and `frontend/` as npm workspaces under one root `package.json`.
- Shared TypeScript base config, ESLint + Prettier, and Vitest in both packages.
- Root scripts `dev`, `lint`, `format`, `format:check`, `typecheck`, `test`, `build` — the canonical checks in `CLAUDE.md`.
- `.env.example` documenting every key; `.env` git-ignored.
- README: prerequisites and how to start.

## Non-goals
- CI pipelines, Docker, deployment.
- A CLI entry point (deferred to phase 4).
- LLM interfaces (E1-2), SQLite/storage (E1-3), any domain logic.
- Production serving of the frontend from the backend; `build` only has to succeed.
- Styling or UI beyond a placeholder page.
- A shared code package between backend and frontend.

## Acceptance Criteria
1. **One command (`npm run dev`) starts both backend and frontend.**
   - From the repo root, `npm run dev` starts the backend (default port `3000`, overridable via `PORT`) and the Vite dev server (default port `5173`) in one terminal.
   - `curl http://localhost:3000/health` returns HTTP 200 with JSON `{"status":"ok"}`.
   - `curl http://localhost:5173/api/health` returns the same JSON through the Vite dev proxy (`/api/*` → backend, with `/api` stripped).
2. **`npm run lint` and `npm run test` run in both packages and pass on a clean checkout.**
   - After `npm ci` on a clean checkout, `npm run lint` lints `backend/` and `frontend/` and exits 0.
   - `npm test` runs Vitest in both workspaces and exits 0, with at least one test per package, and without network access.
   - The full canonical check `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` exits 0.
3. **`.env` is git-ignored and `.env.example` exists.**
   - `git check-ignore .env` prints `.env`.
   - `.env.example` exists at the repo root and documents every key the code reads (at this point: `PORT`), each with a comment.
4. **The frontend shows the backend health status.**
   - With `npm run dev` running, the page at `http://localhost:5173` shows the status returned by `/api/health` (e.g. "Backend: ok").
   - When the backend cannot be reached or answers with an error, the page shows an unreachable/error status instead of crashing or staying blank.
   - A frontend Vitest test with a faked `fetch` covers both the ok and the failure case.
   - A backend Vitest test calls `/health` via Fastify `inject()` (no open port) and asserts status 200 and body `{"status":"ok"}`.

## Tasks
- [ ] Install Node 24 LTS via Homebrew on the dev machine; add `.nvmrc` (`24`) and `"engines": {"node": ">=24"}` in the root `package.json`.
- [ ] Root `package.json` with workspaces `backend`, `frontend` and the root scripts; `package-lock.json` committed.
- [ ] `tsconfig.base.json` at the root, extended by each package.
- [ ] ESLint flat config (typescript-eslint; React hooks rules for the frontend) and Prettier config at the root.
- [ ] Backend: Fastify app factory separated from the listening entry point, `/health` route, dev script with watch, build to `dist/`, Vitest test.
- [ ] Frontend: Vite + React + TS, `/api` dev proxy to the backend, placeholder page showing health status, Vitest test with jsdom and Testing Library.
- [ ] `.gitignore` (`node_modules`, `dist`, `.env`, etc.) and `.env.example`.
- [ ] README section: prerequisites (Node 24), install, `npm run dev`, the check command.

## Decisions
- **npm workspaces** (owner): ships with Node, no extra tool, matches the `npm run` commands in `CLAUDE.md`.
- **Fastify** (owner): built-in TypeScript types and `inject()` for route tests without opening a port.
- **No CLI entry point yet** (owner): deferred to phase 4, when there is something to run.
- **Node 24 LTS installed via Homebrew** (owner): Node was not installed on the machine; 24 is the current LTS line.
- **Vitest** in both packages (default, suggested by the issue); the frontend uses jsdom + `@testing-library/react`.
- **`concurrently`** runs both dev servers from `npm run dev` (default): npm runs workspace scripts sequentially, so a small runner is needed; it is the conventional choice.
- **`tsx`** runs the backend in watch mode during development; `tsc` builds it (default).
- **ESLint flat config + typescript-eslint + Prettier** at the root, shared by both packages (default).
- **Dev proxy prefix `/api`** (default): the frontend calls `/api/health`; Vite strips `/api` before forwarding, so the backend route stays `/health` as the issue states.
- **Extra root scripts `format`, `format:check`, `typecheck`**: not listed in the issue, but required by the canonical check in `CLAUDE.md`.
- **`.env.example` at the repo root**, read by the backend; only `PORT` exists so far.

## Open Questions
- None.
