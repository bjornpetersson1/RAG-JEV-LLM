import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  it('blocks real network access through the global fetch', async () => {
    await expect(fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow(
      'Network access is disabled in tests',
    );
  });
});
