# E1-3 · Database schema

- **Issue:** [#3](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/3)
- **Labels:** `E1 Foundation`
- **Phase:** 1. Foundation
- **Depends on:** E1-1 (#1)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 82 tests (78 backend, 4 frontend) and build exit 0; tests pass with outbound network denied; `db:migrate` twice and `db:reset` checked from both `tsx` and the built `dist`)

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

- [x] `backend/migrations/0001_initial.sql` with the four tables:
  - `documents`: `id` (integer key), `type` (`law` | `ruling`), `title`, `identifier` (unique; SFS number or case number), `court` (rulings, nullable), `date`, `source_url`, `fetched_at`, `raw_text`.
  - `chunks`: `id`, `document_id` (→ documents, cascade delete), `ordinal`, `source_ref`, `text`, `token_count`; unique (`document_id`, `ordinal`).
  - `tags`: `id`, `slug` (unique), `label`, `description`, `area`.
  - `chunk_tags`: `chunk_id` (→ chunks, cascade delete), `tag_id` (→ tags, cascade delete), `model`, `vocabulary_version`, `created_at`; primary key (`chunk_id`, `tag_id`); index on `tag_id`.
- [x] Migration runner: reads `backend/migrations/NNNN_name.sql` in version order, applies each pending one in its own transaction, records version, name and time in a `schema_migrations` table.
- [x] Database opening helper: creates the parent directory, turns on foreign keys and WAL mode.
- [x] Database config: `DATABASE_PATH` from `.env`, default `data/rag.db`, relative paths resolved from the repo root; a clear error for an invalid value.
- [x] CLI with `migrate` and `reset`; backend scripts `db:migrate`, `db:reset` and root scripts that call them.
- [x] `.gitignore`: `data/` and SQLite side files; `.env.example` and README: `DATABASE_PATH` and the two commands.
- [x] Tests for every acceptance criterion.

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
- **Required columns are `NOT NULL`** (settled while implementing): every column except `documents.court`, `documents.date` and `documents.source_url` is required, so an importer cannot store a half-filled row; `chunk_tags` is `WITHOUT ROWID` since its primary key is the pair.
- **Migration file rules**: only `.sql` files are read; one that is not named `NNNN_name.sql`, or two files with the same version, stop the run with an error. A failing migration is rolled back and named in the error.
- **Invalid `DATABASE_PATH`** (clean code): an empty value falls back to the default; any path that cannot be opened (a directory, a parent that is a file, no write permission) fails with "Cannot open database at <path>" and the SQLite error as cause, instead of SQLite's bare "unable to open database file".
- **Skipped clean-code suggestions**: reading only pending migration files (negligible with one file) and a shared env-reading helper (`port.ts` must stay import-free).
- **`.gitignore` also covers `*.db`, `*.db-wal` and `*.db-shm`**, so a database outside `data/` is not committed by accident.
- **Code layout**: `backend/src/db/` holds `config.ts` (path), `database.ts` (open, delete files), `migrations.ts` (runner) and `cli.ts` (the two commands).
- **Migrations run with foreign keys off** (code review): SQLite ignores `PRAGMA foreign_keys` inside a transaction, so with them on a future table rebuild (create, copy, drop, rename) would cascade-delete child rows. The runner turns them off before each migration, runs `PRAGMA foreign_key_check` before committing (a violation rolls the migration back), and turns them on again afterwards.
- **Each migration runs in `BEGIN IMMEDIATE` and re-checks `schema_migrations` inside it** (code review), so two concurrent `db:migrate` runs do not both apply the same file. A failed migration is rolled back only if SQLite has not already done so, so the real error is never hidden.
- **`openDatabase` also wraps the pragmas** (code review): a file that is not a database fails with "Cannot open database at <path>" and the handle is closed.
- **`db:reset` refuses to delete a file that is not a SQLite database** (checked by its 16-byte header; an empty or missing file is fine), so a mistyped `DATABASE_PATH` cannot delete e.g. the README (code review). **Known limitation:** it cannot tell whether another process has the database open; stop the server or an import before resetting.
- **`DATABASE_PATH=:memory:` is rejected** (code review): it would otherwise create a file named `:memory:` in the repo root.
- **`.gitignore` uses `/data/`** (code review), anchored to the repo root, so `data` directories elsewhere (e.g. source or fixtures) are not ignored.
- **The CLI prints errors as one line with their causes** instead of a stack trace.
- **Tests close every database** they open (code review) and use platform-neutral paths.
- **Tracking chunks that got zero tags is left to E3-2** (owner, after code review): `chunk_tags` only shows that a chunk was tagged if it got at least one tag, so E3-2 cannot skip a chunk that got none. E3-2 owns the tagging logic and can add what it needs (e.g. `tagged_model` and `tagged_vocabulary_version` on `chunks`) in a new migration; noted on issue #9.
- **`documents.identifier` is court-qualified for rulings** (PR review): e.g. `AD 2019 nr 35` or `HD T 1234-20`, because bare case numbers repeat across courts and `UNIQUE (court, identifier)` would not work for laws (`court` is NULL, and SQLite treats NULLs as distinct). Laws use the SFS number. E2-3 builds the identifier this way. **Superseded by E2-3:** rulings use their reference number as identifier (`AD 2024 nr 13`, `NJA 2015 s. 741`), which is unique across courts; case numbers are kept in `documents.structure`.

## Open Questions

- None.
