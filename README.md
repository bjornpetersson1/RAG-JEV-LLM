# RAG-JEV-LLM

Legal RAG proof of concept: tag-based search and the JEV judge model find relevant Swedish laws and rulings, and an LLM drafts employment agreements and NDAs from them.

## Prerequisites

- Node.js 24 LTS (see `.nvmrc`); npm ships with it.

## Getting started

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts the backend on http://localhost:3000 and the frontend on http://localhost:5173. The frontend reaches the backend through the Vite dev proxy under `/api`, e.g. `/api/health`.

## Checks

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

`npm run format` rewrites files with Prettier.
