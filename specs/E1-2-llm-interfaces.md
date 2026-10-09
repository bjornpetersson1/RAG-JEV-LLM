# E1-2 · LLM interfaces

- **Issue:** [#2](https://github.com/bjornpetersson1/RAG-JEV-LLM/issues/2)
- **Labels:** `E1 Foundation`
- **Phase:** 1. Foundation
- **Depends on:** E1-1 (#1)
- **Status:** Approved

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
- Any HTTP route or UI that uses the roles; the roles are built at startup but not yet called by the app.
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

- [ ] `backend/src/llm/types.ts`: role names, `Tag`, `Chunk`, and the four role interfaces:
  - `Tagger.tag(chunkText, vocabulary) → Promise<string[]>`
  - `QueryTranslator.translate(instruction, vocabulary) → Promise<string[]>`
  - `Judge.judge(instruction, chunk) → Promise<{ relevant: boolean; score: number }>` (score 0–1)
  - `Generator.generate({ template, instruction, chunks }) → Promise<{ text: string; references: string[] }>` (references are chunk ids)
- [ ] Low-level `LlmClient` interface: one call taking system prompt, user content and a JSON schema, returning the parsed JSON plus usage.
- [ ] Anthropic implementation via `fetch`: forced tool use for structured JSON output, `AbortSignal` timeout, retry with exponential backoff on network errors, timeouts, 429, 5xx and 529 (honouring `retry-after`), no retry on other 4xx; clear error when the response does not match the schema shape.
- [ ] Logger interface compatible with Fastify/pino (`info`/`error` with an object); the server passes `app.log`.
- [ ] Price table for known Claude models (USD per million input/output tokens) and cost estimation; unknown model → no `costUsd`.
- [ ] LLM-backed role implementations with placeholder prompts; tagger and query translator drop tags not in the vocabulary; judge clamps/validates score.
- [ ] Fake client and fake roles: deterministic defaults, overridable with fixed answers or a function.
- [ ] Config loader (`loadLlmConfig(env)`) and factory (`createLlmRoles(config, deps)`).
- [ ] `server.ts`: load config and build roles before `listen`; on config error print it and exit 1.
- [ ] Vitest setup file that stubs global `fetch` to throw.
- [ ] `.env.example` and README: new keys, and that `LLM_PROVIDER=fake` runs without a key.
- [ ] Tests for every acceptance criterion.

## Decisions

- **Anthropic only** (owner): the real provider for now. "Switching provider" is shown between `anthropic` and `fake`; the provider union and factory are the extension point for more. Departs from the issue's open-ended "chosen cloud provider" by fixing it.
- **Default + per-role override** (owner): `LLM_PROVIDER`/`LLM_MODEL` plus `LLM_<ROLE>_PROVIDER`/`LLM_<ROLE>_MODEL`.
- **Built-in `fetch`, no SDK** (owner): no new dependency; retry and timeout are implemented in the client, and tests inject `fetch`.
- **No streaming** (owner): can be added when the UI (E7) needs it.
- **Cost from a price table in code** (owner): estimated USD per call for known Claude models, omitted for unknown models. Prices are taken from Anthropic's current published pricing at implementation time.
- **No budget enforcement** (owner): spending is followed through the logs and the Anthropic console.
- **Validate at backend startup, `fake` allowed in `.env`** (owner): the server refuses to start with invalid LLM config; `LLM_PROVIDER=fake` lets the app run without a key. Consequence: a fresh clone needs a `.env` (copied from `.env.example`) before `npm run dev`, unlike after E1-1; the README says so.
- **LLM-backed role implementations with placeholder prompts** (default): the issue asks for a real implementation but puts prompt contents out of scope; minimal prompts make the wiring testable and are replaced in E3-2, E4-4, E5-1 and E6-1/E6-2.
- **Structured output via forced tool use** (default): the client sends the JSON schema as a single tool and requires the model to call it, which is the established way to get schema-shaped JSON from the Messages API.
- **Retry defaults** (default): `LLM_MAX_RETRIES=2` (3 attempts), `LLM_TIMEOUT_MS=60000`, exponential backoff with jitter starting at about 500 ms; both values configurable in `.env`, shared by all roles.
- **Code lives in `backend/src/llm/`** (default): the backend is the only consumer.
- **Hand-written config validation** (default): no schema library for a handful of variables.
- **Fakes are not logged** (default): the criterion is about real calls.

## Open Questions

- None.
