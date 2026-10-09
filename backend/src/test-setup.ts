import { vi } from 'vitest';

// Tests must never reach the network: real LLM calls are replaced by fakes or an injected fetch.
vi.stubGlobal('fetch', async (input: unknown) => {
  throw new Error(`Network access is disabled in tests (fetch ${String(input)})`);
});
