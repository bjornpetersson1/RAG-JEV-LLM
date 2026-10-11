import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database.js';
import { syncVocabulary } from '../tagging/sync-vocabulary.js';
import { createTaggingWorkspace } from '../tagging/test-helpers.js';
import { loadTagIndex, type IndexLogger } from './load-index.js';
import { buildRoaringIndex } from './roaring-index.js';
import { EMPTY_TAG_INDEX } from './tag-index.js';

describe('loadTagIndex', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('builds the index from chunk_tags by tag slug and logs its stats', () => {
    const workspace = taggingWorkspace();
    const [first, second, third] = workspace.addChunks('1982:80', ['a', 'b', 'c']);
    syncVocabulary(
      workspace.db,
      ['uppsagning', 'sekretess'].map((slug) => ({
        slug,
        label: slug,
        description: 'd',
        area: 'anstallning',
      })),
    );
    workspace.linkTag(first, 'uppsagning');
    workspace.linkTag(second, 'uppsagning');
    workspace.linkTag(second, 'sekretess');
    workspace.linkTag(third, 'sekretess');
    const logger = createLogger();

    const index = loadTagIndex(workspace.path, buildRoaringIndex, logger);
    cleanups.push(() => index.dispose());

    expect(index.searchAll(['uppsagning', 'sekretess'])).toEqual([second]);
    expect(index.searchAny(['uppsagning'])).toEqual([first, second]);
    expect(index.searchRanked(['uppsagning', 'sekretess'])[0]).toEqual({
      chunkId: second,
      matches: 2,
    });
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        chunks: 3,
        tags: 2,
        chunkTags: 4,
        buildMs: expect.any(Number),
        memoryBytes: expect.any(Number),
      },
      'Tag index built',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gives an empty index and a warning when the database file is missing', () => {
    const path = join(tempDir(), 'missing.db');
    const logger = createLogger();

    const index = loadTagIndex(path, buildRoaringIndex, logger);

    expect(index).toBe(EMPTY_TAG_INDEX);
    expectWarning(logger, `no database at ${path}`, 'npm run db:migrate');
  });

  it('gives an empty index and a warning when the database is not migrated', () => {
    const path = join(tempDir(), 'empty.db');
    openDatabase(path).close();
    const logger = createLogger();

    const index = loadTagIndex(path, buildRoaringIndex, logger);

    expect(index).toBe(EMPTY_TAG_INDEX);
    expectWarning(logger, 'pending migrations (1_initial, ', 'npm run db:migrate');
  });

  it('gives an empty index and a warning when the database has no chunks', () => {
    const workspace = taggingWorkspace();
    const logger = createLogger();

    const index = loadTagIndex(workspace.path, buildRoaringIndex, logger);

    expect(index).toBe(EMPTY_TAG_INDEX);
    expectWarning(logger, 'no chunks', 'the data commands');
  });

  it('gives an empty index and a warning when no chunk has tags', () => {
    const workspace = taggingWorkspace();
    workspace.addChunks('1982:80', ['a']);
    const logger = createLogger();

    const index = loadTagIndex(workspace.path, buildRoaringIndex, logger);

    expect(index).toBe(EMPTY_TAG_INDEX);
    expectWarning(logger, 'no chunk has tags', 'npm run index:tag');
  });

  function taggingWorkspace() {
    const workspace = createTaggingWorkspace();
    cleanups.push(workspace.remove);
    return workspace;
  }

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'load-index-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }
});

function createLogger() {
  return { info: vi.fn(), warn: vi.fn() } satisfies IndexLogger;
}

function expectWarning(logger: ReturnType<typeof createLogger>, ...parts: string[]): void {
  expect(logger.info).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    expect.stringMatching(/^Tag index is empty: /),
  );
  const [, message] = logger.warn.mock.calls[0];
  for (const part of parts) expect(message).toContain(part);
}
