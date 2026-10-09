# E1-3 · Database schema

- **Issue:** [#3](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/3)
- **Labels:** `E1 Foundation`
- **Phase:** 1. Foundation
- **Depends on:** E1-1 (#1)
- **Status:** Approved

## Summary

A SQLite database with tables for documents, chunks, tags and chunk–tag links, created by numbered SQL migrations that run from an empty database, plus `db:migrate` and `db:reset` commands. Later issues add tables (FTS5 in E4-3, caching in E5-2) as further migrations and fill the tables (E2-2 to E3-2).

## Goals

- SQLite through Node's built-in `node:sqlite`.
- A migration runner: numbered `.sql` files applied in order, each once, recorded in a migrations table.
- The first migration with `documents`, `chunks`, `tags` and `chunk_tags`, including keys, constraints and indexes.
- `npm run db:migrate` and `npm run db:reset` from the repo root.
- Database path from `.env` (`DATABASE_PATH`), with a git-ignored default.

## Non-goals

- A data-access layer (insert/query functions per table); the importers and tagger (E2-2 to E3-2) add what they need.
- Loading the index into memory or opening the database when the backend server starts (E4-1); the server does not touch the database in this issue.
- FTS5 tables (E4-3) and caching tables (E5-2).
- Importing any real data, or a tag vocabulary (E3-1).
- Down-migrations / rollback; `db:reset` rebuilds from scratch instead.

## Acceptance Criteria

1. **`db:migrate` runs on an empty database without errors and is idempotent.**
   - With `DATABASE_PATH` pointing to a file that does not exist (in a directory that may not exist), `npm run db:migrate` creates it, applies every migration, prints which ones it applied, and exits 0.
   - Running it again exits 0, applies nothing, says so, and leaves the schema and the migrations table unchanged.
   - A unit test runs the migration runner twice on a fresh database and asserts the set of tables and the recorded migration versions are the same after both runs.
   - `npm run db:reset` deletes the database file and migrates it again, exiting 0.
2. **A test creates a document, chunk, tag and link and reads them back.**
   - A Vitest test on a temporary database inserts one `documents` row, one `chunks` row for it, one `tags` row and one `chunk_tags` row, then reads them back with a join and asserts every stored column.
   - Tests also prove the constraints: a `chunk_tags` row for a missing chunk is rejected (foreign keys are on), a duplicate (chunk, tag) pair is rejected, a duplicate `documents.identifier` and `tags.slug` are rejected, a `documents.type` other than `law`/`ruling` is rejected, and deleting a document deletes its chunks and their tag links.
   - The tests run without network access and leave no files behind.
3. **The database file is git-ignored.**
   - `git check-ignore data/rag.db` prints the path, and so does a database at a custom path under `data/`; SQLite's side files (`-wal`, `-shm`) are ignored too.
   - `.env.example` documents `DATABASE_PATH` with a comment.

## Tasks

- [ ] `backend/migrations/0001_initial.sql` with the four tables:
  - `documents`: `id` (integer key), `type` (`law` | `ruling`), `title`, `identifier` (unique; SFS number or case number), `court` (rulings, nullable), `date`, `source_url`, `fetched_at`, `raw_text`.
  - `chunks`: `id`, `document_id` (→ documents, cascade delete), `ordinal`, `source_ref`, `text`, `token_count`; unique (`document_id`, `ordinal`).
  - `tags`: `id`, `slug` (unique), `label`, `description`, `area`.
  - `chunk_tags`: `chunk_id` (→ chunks, cascade delete), `tag_id` (→ tags, cascade delete), `model`, `vocabulary_version`, `created_at`; primary key (`chunk_id`, `tag_id`); index on `tag_id`.
- [ ] Migration runner: reads `backend/migrations/NNNN_name.sql` in version order, applies each pending one in its own transaction, records version, name and time in a `schema_migrations` table.
- [ ] Database opening helper: creates the parent directory, turns on foreign keys and WAL mode.
- [ ] Database config: `DATABASE_PATH` from `.env`, default `data/rag.db`, relative paths resolved from the repo root; a clear error for an invalid value.
- [ ] CLI with `migrate` and `reset`; backend scripts `db:migrate`, `db:reset` and root scripts that call them.
- [ ] `.gitignore`: `data/` and SQLite side files; `.env.example` and README: `DATABASE_PATH` and the two commands.
- [ ] Tests for every acceptance criterion.

## Decisions

- **`node:sqlite`** (owner): built into Node 24, so no new dependency or native build; its synchronous API suits a local POC. Verified locally that it runs without an experimental warning on Node 24.21 and has FTS5 (SQLite 3.53), which E4-3 needs. Departs from the issue's example `better-sqlite3`.
- **Raw text in the database** (owner): `documents.raw_text`; one file to manage, and the data set is small.
- **`chunk_tags` records `model` and `vocabulary_version`** (owner): enough for E3-2 to skip chunks already tagged with the current vocabulary and model, and to see which run made a tag. Departs from the issue's suggested columns by adding these two.
- **Integer keys plus unique natural keys** (owner): `INTEGER PRIMARY KEY` ids, with unique `documents.identifier`, `chunks(document_id, ordinal)` and `tags.slug`, so re-imports can match existing rows.
- **No migration at server start** (owner): only `db:migrate` touches the schema; the server will open the database when it first needs it (E4-1).
- **Default path `data/rag.db` at the repo root** (owner), overridable with `DATABASE_PATH`; relative values resolve from the repo root so every workspace script points to the same file.
- **Migrations as plain `.sql` files in `backend/migrations/`** (default, as the issue suggests), read at run time from the package directory, so they work from both `src` and `dist` without a copy step.
- **Migrations run through `tsx`** (default): the `db:*` scripts run the TypeScript CLI directly, like the `dev` script, so no build is needed first.
- **`db:reset` deletes the file** (default), including `-wal`/`-shm`, then migrates; simpler and more complete than dropping tables.
- **Dates as ISO 8601 text** (default), SQLite's conventional date format.
- **`tags.area` as a text column** (default): the vocabulary (E3-1) defines the areas; a separate table can come later if needed.
- **WAL mode and foreign keys on** (default): foreign keys are off by default in SQLite and must be enabled per connection; WAL allows reading while an import writes.

## Open Questions

- None.
