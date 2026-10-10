# RAG-JEV-LLM

Legal RAG proof of concept: tag-based search and the JEV judge model find relevant Swedish laws and rulings, and an LLM drafts employment agreements and NDAs from them.

## Prerequisites

- Node.js 24 LTS (see `.nvmrc`); npm ships with it.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY, or LLM_PROVIDER=fake to run without a key
npm run dev
```

`npm run dev` starts the backend on http://localhost:3000 and the frontend on http://localhost:5173. The frontend reaches the backend through the Vite dev proxy under `/api`, e.g. `/api/health`.

The backend needs a `.env`: it validates the LLM settings at startup and exits with a list of what is missing or invalid. Either set `ANTHROPIC_API_KEY`, or set `LLM_PROVIDER=fake` to run without a key (deterministic fake answers, no network).

## Database

SQLite through Node's built-in `node:sqlite`. The schema lives in numbered SQL files in `backend/migrations/`.

```bash
npm run db:migrate   # create the database or apply new migrations (safe to re-run)
npm run db:reset     # delete the database file and migrate from scratch
```

The file is `data/rag.db` by default, or `DATABASE_PATH` from `.env` (relative paths resolve from the repo root). `data/` is git-ignored.

## Data sources

The POC uses a fixed selection of 11 Swedish laws and 50 court rulings (45 from the Labour Court, AD, and 5 from the Supreme Court, HD) around employment, contracts and confidentiality. The list is committed in `sources/selection.json`; the documents themselves are fetched on demand.

```bash
npm run data:fetch            # download what is missing into data/raw/ (well under a minute)
npm run data:fetch -- --force # download everything again
```

The raw files are stored unchanged under `data/raw/laws/` and `data/raw/rulings/`, which are git-ignored, together with `data/raw/manifest.json`. The manifest lists every fetched document with its identifier, source URL, fetch time and file. A document that fails is logged, the rest are still fetched, and the command exits non-zero at the end.

| Source                                                                                                                                                                       | Used for                | Format stored                                                                                                                     | Terms                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [SFST, Regeringskansliet's legal database](https://rkrattsbaser.gov.se/) (`https://rkrattsbaser.gov.se/sfst?bet=<SFS number>`)                                               | Laws, consolidated text | The HTML page, with the law text as plain preformatted text and header fields such as "Utfärdad" and "Ändring införd: t.o.m. SFS" | Statutes are public documents without copyright (1 kap. 9 § upphovsrättslagen, 1960:729)                                        |
| [Domstolsverket's case-law API](https://www.domstol.se/om-webbplatsen-och-digitala-kanaler/oppna-data/) (`https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar/<id>`) | Rulings from AD and HD  | The JSON record, with the full ruling as HTML in `innehall` plus reference and case numbers and the decision date                 | Published by Domstolsverket as open data; court decisions are public documents without copyright (1 kap. 9 § upphovsrättslagen) |

Riksdagen's open data API (`data.riksdagen.se`) was considered for laws but refused connections when the sources were chosen.

## LLM configuration

Each LLM role (tagger, query translator, judge, generator) gets its provider and model from `.env`, so switching needs no code change:

- `LLM_PROVIDER` (`anthropic` or `fake`) and `LLM_MODEL` are the defaults for every role.
- `LLM_<ROLE>_PROVIDER` and `LLM_<ROLE>_MODEL` override them for one role, where `ROLE` is `TAGGER`, `QUERY_TRANSLATOR`, `JUDGE` or `GENERATOR`.
- `LLM_TIMEOUT_MS` and `LLM_MAX_RETRIES` tune the request timeout and retries.

Every real call is logged with role, model, latency, token usage and estimated cost. See `.env.example` for all keys.

## Checks

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

`npm run format` rewrites files with Prettier.
