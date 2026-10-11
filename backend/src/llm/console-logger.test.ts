import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleLogger } from './console-logger.js';

describe('createConsoleLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints each entry as its message and JSON, leaving out info lines when quiet', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createConsoleLogger().info({ chunks: 3 }, 'Tagged chunk');
    createConsoleLogger({ quiet: true }).info({ chunks: 3 }, 'Tagged chunk');
    createConsoleLogger({ quiet: true }).warn({ chunkId: 'c1' }, 'Chunk could not be judged');

    expect(log.mock.calls).toEqual([['Tagged chunk {"chunks":3}']]);
    expect(warn.mock.calls).toEqual([['Chunk could not be judged {"chunkId":"c1"}']]);
  });
});
