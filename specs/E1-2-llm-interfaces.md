# E1-2 · LLM interfaces

- **Issue:** [#2](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/2)
- **Labels:** `E1 Foundation`
- **Phase:** 1. Foundation
- **Depends on:** E1-1 (#1)
- **Status:** Implemented — all acceptance criteria verified (npm ci, lint, format:check, typecheck, 60 tests (56 backend, 4 frontend) and build exit 0; tests pass with outbound network denied; startup error checked on the built server)

## Summary

One TypeScript interface per LLM role (Tagger, QueryTranslator, Judge, Generator), a shared low-level LLM client against the Anthropic Messages API with retry, timeout and token/cost logging, deterministic fakes for tests, and a validated `.env` config that picks provider and model per role. Later issues plug their prompts and adapters into these interfaces.

## Goals

- Role interfaces and their input/output types in `backend/src/llm/`.
- A low-level client interface (one structured-JSON completion call) with an Anthropic implementation using Node's built-in `fetch`.
- Retry with backoff, a per-call timeout, and one log entry per real call (role, provider, model, latency, tokens, estimated cost).
- A thin LLM-backed implementation of each role on top of the client, with minimal placeholder prompts.
- Deterministic, configurable fake implementations of every role and of the low-level client.
- A config loader that reads `.env`, resolves provider and model per role (default + per-role override), validates everything, and fails at backend startup with a clear message.
- A factory that builds all four roles from the config.

## Non-goals

- Real prompt contents: tagging (E3-2), query translation (E4-4), judging fallback (E5-1), generation (E6-1/E6-2). The placeholder prompts here only make the wiring work.
- The JEV REST adapter (E5-1); it will implement the `Judge` interface defined here.
- Providers other than Anthropic (OpenAI etc.); the provider union is open for adding them later.
- Streaming responses.
- Enforcing a monthly budget or persisting usage; cost is only logged.
- Any HTTP route or UI that uses the roles; the server only validates the LLM config at startup.
- Official provider SDKs.

## Acceptance Criteria

1. **Switching model or provider for any role requires only an `.env` change.**
   - `LLM_PROVIDER` and `LLM_MODEL` set the default for all roles; `LLM_<ROLE>_PROVIDER` and `LLM_<ROLE>_MODEL` (`ROLE` ∈ `TAGGER`, `QUERY_TRANSLATOR`, `JUDGE`, `GENERATOR`) override them per role. Supported providers: `anthropic`, `fake`.
   - Unit tests show that, given only different environment values, the factory builds each role with the expected provider and model (e.g. default `anthropic`/model A, generator overridden to model B, judge overridden to `fake`), and that the Anthropic request body for a role carries that role's model.
   - No code change is needed between those cases: the tests call the same factory with different env objects.
2. **The full test suite runs with no network access (fakes used in tests).**
   - The backend Vitest setup replaces global `fetch` with a function that throws, so any accidental real call fails the suite.
   - Tests of the Anthropic client inject a fake `fetch`; role tests use the fake client or fake roles.
   - `npm test` exits 0 with networking disabled (e.g. Wi-Fi off), and no test needs `ANTHROPIC_API_KEY`.
3. **Each real call logs role, model, latency and token usage.**
   - Every completed Anthropic call (success or final failure) emits exactly one structured log entry with at least `role`, `provider`, `model`, `latencyMs`, `inputTokens`, `outputTokens` (tokens on success), `attempts`, and `costUsd` when the model is in the price table.
   - A unit test with an injected fake `fetch` and a capturing logger asserts these fields, including after a retry.
4. **Missing/invalid config gives a clear startup error.**
   - The loader throws an error naming the offending variable and what is expected for: missing `LLM_PROVIDER`; an unknown provider (default or per-role); a role resolving to `anthropic` with no model; `anthropic` used by any role with a missing/empty `ANTHROPIC_API_KEY`; a non-positive-integer `LLM_TIMEOUT_MS` or a negative/non-integer `LLM_MAX_RETRIES`. All errors found are reported together.
   - Unit tests cover each case above and a valid config.
   - `server.ts` loads the config before listening; with an invalid `.env`, `npm run dev -w backend` prints the message (no stack trace needed) and exits non-zero.
   - `.env.example` documents every new key with a comment.

## Tasks

- [x] `backend/src/llm/types.ts`: role names, `Tag`, `Chunk`, and the four role interfaces:
  - `Tagger.tag(chunkText, vocabulary) → Promise<string[]>`
  - `QueryTranslator.translate(instruction, vocabulary) → Promise<string[]>`
  - `Judge.judge(instruction, chunk) → Promise<{ relevant: boolean; score: number }>` (score 0–1)
  - `Generator.generate({ template, instruction, chunks }) → Promise<{ text: string; references: string[] }>` (references are chunk ids)
- [x] Low-level `LlmClient` interface: one call taking system prompt, user content and a JSON schema, returning the parsed JSON plus usage.
- [x] Anthropic implementation via `fetch`: structured outputs (`output_config.format`, JSON schema) for structured JSON output, `AbortSignal` timeout, retry with exponential backoff on network errors, timeouts, 429, 5xx and 529 (honouring `retry-after`), no retry on other 4xx; clear error when the response does not match the schema shape.
- [x] Logger interface compatible with Fastify/pino (`info`/`error` with an object); the server passes `app.log`.
- [x] Price table for known Claude models (USD per million input/output tokens) and cost estimation; unknown model → no `costUsd`.
- [x] LLM-backed role implementations with placeholder prompts; tagger and query translator drop tags not in the vocabulary; judge clamps/validates score.
- [x] Fake client and fake roles: deterministic defaults, overridable with fixed answers or a function.
- [x] Config loader (`loadLlmConfig(env)`) and factory (`createLlmRoles(config, deps)`).
- [x] `server.ts`: load and validate the config before `listen`; on config error print it and exit 1.
- [x] Vitest setup file that stubs global `fetch` to throw.
- [x] `.env.example` and README: new keys, and that `LLM_PROVIDER=fake` runs without a key.
- [x] Tests for every acceptance criterion.

## Decisions

- **Anthropic only** (owner): the real provider for now. "Switching provider" is shown between `anthropic` and `fake`; the provider union and factory are the extension point for more. Departs from the issue's open-ended "chosen cloud provider" by fixing it.
- **Default + per-role override** (owner): `LLM_PROVIDER`/`LLM_MODEL` plus `LLM_<ROLE>_PROVIDER`/`LLM_<ROLE>_MODEL`.
- **Built-in `fetch`, no SDK** (owner): no new dependency; retry and timeout are implemented in the client, and tests inject `fetch`.
- **No streaming** (owner): can be added when the UI (E7) needs it.
- **Cost from a price table in code** (owner): estimated USD per call for known Claude models, omitted for unknown models. Prices are taken from Anthropic's current published pricing at implementation time.
- **No budget enforcement** (owner): spending is followed through the logs and the Anthropic console.
- **Validate at backend startup, `fake` allowed in `.env`** (owner): the server refuses to start with invalid LLM config; `LLM_PROVIDER=fake` lets the app run without a key. Consequence: a fresh clone needs a `.env` (copied from `.env.example`) before `npm run dev`, unlike after E1-1; the README says so.
- **LLM-backed role implementations with placeholder prompts** (default): the issue asks for a real implementation but puts prompt contents out of scope; minimal prompts make the wiring testable and are replaced in E3-2, E4-4, E5-1 and E6-1/E6-2.
- **Structured output via `output_config.format` (JSON schema)** (owner, during implementation): the approved spec said forced tool use, but current Claude models (Opus 5.5, Sonnet 5.5, Fable 5.1) reject a forced `tool_choice` with HTTP 400. Structured outputs are supported by every current model and return schema-valid JSON in a text block. Departs from the approved spec.
- **Retry defaults** (default, timeout raised in code review): `LLM_MAX_RETRIES=2` (3 attempts, allowed 0–10), `LLM_TIMEOUT_MS=600000` (10 min, like the Anthropic SDK default, because a non-streaming draft with adaptive thinking can take minutes; allowed up to 2^31 − 1, the largest delay Node timers support), exponential backoff with jitter starting at about 500 ms; both configurable in `.env`, shared by all roles.
- **Code lives in `backend/src/llm/`** (default): the backend is the only consumer.
- **Hand-written config validation** (default): no schema library for a handful of variables.
- **Fakes are not logged** (default): the criterion is about real calls.
- **Default model `claude-opus-5-5` in `.env.example`**: Anthropic's current default model; cheaper models can be set per role.
- **No `thinking` parameter is sent**: current models run adaptive thinking by default, and some reject explicit settings; effort tuning is left to the prompt issues.
- **Response handling**: a `stop_reason` other than `end_turn` (e.g. `refusal`, `max_tokens`), a missing text block, a malformed body or non-JSON text is a non-retryable error; the failure log still carries the tokens and cost the response reports (code review). Only the HTTP exchange (request and reading the body) is classified as retryable transport failure, so response-shape errors are never retried (code review). `max_tokens` defaults to 16 000 and can be set per request.
- **Backoff**: `retry-after` (seconds) is used when present; otherwise exponential backoff from 500 ms, capped at 30 s, with jitter between half and the full delay. A `retry-after` above 30 s ends the call instead of blocking the caller (code review).
- **API key lives in each Anthropic role's config**, so the factory never handles a missing key; `loadLlmConfig` lists all problems before throwing.
- **Fake defaults**: tagger and query translator return the vocabulary tags whose name appears in the text; the judge scores the share of instruction keywords (4+ letters, split on non-letters so Swedish å/ä/ö stay whole) found in the chunk, relevant at ≥ 0.5; the generator echoes template, instruction and chunks and cites every chunk. Each fake takes an optional answer function. `createFakeLlmClient` records requests for testing the LLM-backed roles.
- **LLM-backed roles sanitise answers**: unknown and duplicate tags are dropped, the judge score is clamped to 0–1, generator references are limited to the given chunk ids and de-duplicated, and a wrongly shaped answer is an error.
- **Haiku 5.5 long-prompt pricing**: the price table supports the higher rate above 100K input tokens.
- **Startup check verified with the built server**: `tsx watch` (the `dev` script) keeps watching after the process exits, so "exits non-zero" is checked with `node dist/server.js` (same code path as `npm start`); under `npm run dev` the message is printed and the watcher waits for a fix.
- **Test files**: `backend/vitest.config.ts` registers `src/test-setup.ts`; shared test fakes live in `src/llm/test-helpers.ts`. Both are excluded from the build in `tsconfig.build.json`.

- **Retry and logging are provider-independent** (clean code): `withRetryAndLogging` in `retrying-client.ts` owns retries, backoff and the one log entry per call; the Anthropic client is a single-attempt transport wrapped by it, so a new provider only supplies the transport. Transport errors (timeouts, network `TypeError`) are classified for the whole attempt, including reading the body.
- **The server validates the config but does not build the roles yet** (clean code): building them only to discard the result proved nothing beyond `loadLlmConfig`; the routes that use the roles (later issues) will build them with `createLlmRoles`. Departs from the approved task "build roles before `listen`".
- **`Chunk` carries an optional `source`** (PR review): a source reference such as "SFS 1982:80 7 §"; the clean-code pass had dropped it as unused, but E6-1, E3-2 and E5-1 need a source reference per chunk. The placeholder generator prompt shows it next to the chunk id.
- **Skipped clean-code suggestions**: a shared schema-plus-type-guard helper for role outputs (left to the prompt issues, which will reshape the outputs), a provider registry (one real provider so far), deriving `ROLE_ENV_KEYS` from the role names (the explicit table is clearer), sharing integer parsing with `port.ts` (which must stay import-free), and prompt caching of the vocabulary (placeholder prompts are below the cache minimum).
- **Cost of attempts that time out is not logged** (code review finding, not fixed): an aborted request returns no usage, so its tokens cannot be known client-side; the log's `attempts` count shows that earlier attempts failed, and the Anthropic console remains the source of truth for spend.
- **"No network" verified with a macOS sandbox**: `sandbox-exec` with `(deny network-outbound (remote ip))` blocks outbound connections (curl to api.anthropic.com fails), and `npm test` still exits 0 with `ANTHROPIC_API_KEY` unset; this stands in for turning Wi-Fi off.

## Open Questions

- None.
