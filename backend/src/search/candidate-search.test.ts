import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate, readMigrations } from '../db/migrations.js';
import { createTestDatabase } from '../db/test-helpers.js';
import { syncVocabulary } from '../tagging/sync-vocabulary.js';
import { createTaggingWorkspace } from '../tagging/test-helpers.js';
import { createCandidateSearch } from './candidate-search.js';
import { buildRoaringIndex } from './roaring-index.js';
import type { ChunkTag, TagIndex } from './tag-index.js';
import { createIndexLogger } from './test-helpers.js';

describe('createCandidateSearch', () => {
  let workspace: ReturnType<typeof createTaggingWorkspace>;
  let tagIndex: TagIndex | undefined;
  let chunkIds: number[];

  beforeEach(() => {
    workspace = createTaggingWorkspace();
    chunkIds = workspace.addChunks('1982:80', [
      'Uppsägning från arbetsgivarens sida ska vara sakligt grundad.',
      'Arbetstagaren har rätt till semester.',
      'En uppsägningstid om en månad gäller.',
      'Lön betalas ut månadsvis.',
      'Konkurrensklausul och vite.',
    ]);
    syncVocabulary(workspace.db, [
      { slug: 'uppsagning', label: 'Uppsägning', description: 'd', area: 'anstallning' },
      { slug: 'lon', label: 'Lön', description: 'd', area: 'anstallning' },
    ]);
  });

  afterEach(() => {
    tagIndex?.dispose();
    workspace.remove();
  });

  /** A candidate search over the workspace, with `tagged` as the tag index's contents. */
  function searchWith(tagged: ChunkTag[], config = { minTagCandidates: 2, maxCandidates: 4 }) {
    tagIndex?.dispose();
    tagIndex = buildRoaringIndex(tagged);
    const logger = createIndexLogger();
    const search = createCandidateSearch({ db: workspace.db, tagIndex, config, logger });
    return { search, logger };
  }

  it('uses only tag candidates when there are at least N, without a full-text query', () => {
    const [first, second, third] = chunkIds;
    const { search, logger } = searchWith([
      { chunkId: first, slug: 'uppsagning' },
      { chunkId: third, slug: 'uppsagning' },
      { chunkId: second, slug: 'lon' },
      { chunkId: third, slug: 'lon' },
    ]);

    const result = search.search({ instruction: 'Lön', tags: ['uppsagning', 'lon'] });

    expect(result.candidates).toEqual([
      { chunkId: third, origin: 'tag' },
      { chunkId: first, origin: 'tag' },
      { chunkId: second, origin: 'tag' },
    ]);
    expect(result).toMatchObject({ fallbackUsed: false, ftsAdded: 0, ftsQuery: null });
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      { mode: 'tags+fts', tagCandidates: 3, fallbackUsed: false, ftsAdded: 0, ftsQuery: null },
      'Candidate search',
    );
  });

  it('cuts tag candidates to the maximum', () => {
    const { search } = searchWith(chunkIds.map((chunkId) => ({ chunkId, slug: 'lon' })));

    expect(search.search({ instruction: '', tags: ['lon'] }).candidates).toHaveLength(4);
  });

  it('fills up with full-text candidates after the tag candidates when there are fewer than N', () => {
    const [first, , third] = chunkIds;
    const { search, logger } = searchWith([{ chunkId: first, slug: 'uppsagning' }]);

    const result = search.search({ instruction: 'uppsägningen', tags: ['uppsagning'] });

    // "uppsägnin"* (the instruction) and "uppsägn"* (the label) both match chunks 1 and 3.
    expect(result.candidates).toEqual([
      { chunkId: first, origin: 'tag' },
      { chunkId: third, origin: 'fts' },
    ]);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        mode: 'tags+fts',
        tagCandidates: 1,
        fallbackUsed: true,
        ftsAdded: 1,
        ftsQuery: '"uppsägnin"* OR "uppsägn"*',
      },
      'Candidate search',
    );
  });

  it('lists a chunk found by both searches once, as a tag candidate', () => {
    const [first] = chunkIds;
    const { search } = searchWith([{ chunkId: first, slug: 'lon' }]);

    // Full-text search alone finds only the first chunk for these words.
    expect(
      search.search({ instruction: 'sakligt grundad', tags: [], mode: 'fts' }).candidates,
    ).toEqual([{ chunkId: first, origin: 'fts' }]);
    const result = search.search({ instruction: 'sakligt grundad', tags: ['lon'] });

    // The label "Lön" adds the fourth chunk; the first is not repeated.
    expect(result.candidates).toEqual([
      { chunkId: first, origin: 'tag' },
      { chunkId: chunkIds[3], origin: 'fts' },
    ]);
    expect(result.ftsAdded).toBe(1);
  });

  it.each([
    [2, false],
    [3, true],
  ])('with N = %i and two tag candidates, the fallback runs: %s', (minTagCandidates, runs) => {
    const [first, second] = chunkIds;
    const { search } = searchWith(
      [
        { chunkId: first, slug: 'lon' },
        { chunkId: second, slug: 'lon' },
      ],
      { minTagCandidates, maxCandidates: 4 },
    );

    expect(search.search({ instruction: 'vite', tags: ['lon'] }).fallbackUsed).toBe(runs);
  });

  it('searches full text only in mode fts, up to the maximum', () => {
    const { search, logger } = searchWith(chunkIds.map((chunkId) => ({ chunkId, slug: 'lon' })));

    const result = search.search({
      instruction: 'månadsvis uppsägning',
      tags: ['lon'],
      mode: 'fts',
    });

    expect(result.tagCandidates).toBe(0);
    expect(result.candidates.every((candidate) => candidate.origin === 'fts')).toBe(true);
    // bm25 order: the fourth chunk matches two terms ("månads"* and the label's "lön"*); of the
    // two that match only "uppsägn"*, the shorter text ranks first.
    expect(result.candidates.map((candidate) => candidate.chunkId)).toEqual([
      chunkIds[3],
      chunkIds[2],
      chunkIds[0],
    ]);
    expect(logger.info.mock.calls[0][0]).toMatchObject({ mode: 'fts', fallbackUsed: true });
  });

  it('searches tags only in mode tags, even with fewer than N', () => {
    const [first] = chunkIds;
    const { search } = searchWith([{ chunkId: first, slug: 'lon' }]);

    const result = search.search({ instruction: 'semester', tags: ['lon'], mode: 'tags' });

    expect(result.candidates).toEqual([{ chunkId: first, origin: 'tag' }]);
    expect(result).toMatchObject({ fallbackUsed: false, ftsQuery: null });
  });

  it('keeps å, ä and ö apart from a and o', () => {
    const { search } = searchWith([]);

    expect(search.search({ instruction: 'lon', tags: [], mode: 'fts' }).candidates).toEqual([]);
    expect(search.search({ instruction: 'lön', tags: [], mode: 'fts' }).candidates).toEqual([
      { chunkId: chunkIds[3], origin: 'fts' },
    ]);
  });

  it('runs no full-text query when the instruction has no usable words and there are no tags', () => {
    const { search } = searchWith([]);

    expect(search.search({ instruction: 'och att, för!', tags: [] })).toEqual({
      candidates: [],
      tagCandidates: 0,
      fallbackUsed: false,
      ftsAdded: 0,
      ftsQuery: null,
    });
  });
});

describe('chunks_fts', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function matches(db: DatabaseSync, query: string): number[] {
    type Row = { id: number };
    const sql = 'SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rowid';
    return (db.prepare(sql).all(query) as Row[]).map((row) => row.id);
  }

  it('follows inserts, updates and deletes of chunks', () => {
    const workspace = createTaggingWorkspace();
    cleanup = workspace.remove;
    const [id] = workspace.addChunks('1982:80', ['Semester om 25 dagar.']);
    const { db } = workspace;

    expect(matches(db, 'semester')).toEqual([id]);
    expect(matches(db, '"1982"')).toEqual([id]);

    db.prepare("UPDATE chunks SET text = 'Lön per månad.' WHERE id = ?").run(id);
    expect(matches(db, 'semester')).toEqual([]);
    expect(matches(db, 'lön')).toEqual([id]);

    db.prepare("UPDATE chunks SET context = 'Semesterlag' WHERE id = ?").run(id);
    expect(matches(db, 'semesterlag')).toEqual([id]);

    db.prepare('DELETE FROM chunks WHERE id = ?').run(id);
    expect(matches(db, 'lön')).toEqual([]);
  });

  it('indexes the chunks that existed before the migration', () => {
    // A database at migration 4, before the full-text index existed.
    const earlierMigrations = mkdtempSync(join(tmpdir(), 'migrations-'));
    cleanup = () => rmSync(earlierMigrations, { recursive: true, force: true });
    for (const { version, name, sql } of readMigrations(MIGRATIONS_DIR)) {
      const file = `${String(version).padStart(4, '0')}_${name}.sql`;
      if (version < 5) writeFileSync(join(earlierMigrations, file), sql);
    }
    const { db, remove } = createTestDatabase('fts-migration-', earlierMigrations);
    const removeMigrations = cleanup;
    cleanup = () => {
      remove();
      removeMigrations();
    };
    db.exec(`INSERT INTO documents (type, title, identifier, fetched_at, raw_text, structure)
             VALUES ('law', 'Lag', '1982:80', '2026-10-11', '', '{}')`);
    db.exec(`INSERT INTO chunks (document_id, ordinal, source_ref, text, context, token_count)
             VALUES (1, 0, '1 §', 'Uppsägning ska vara sakligt grundad.', 'Lag', 10)`);

    migrate(db);

    expect(matches(db, 'sakligt')).toEqual([1]);
  });

  it('is not rewritten when a chunk is updated with the same content', () => {
    const workspace = createTaggingWorkspace();
    cleanup = workspace.remove;
    const [id] = workspace.addChunks('1982:80', ['Semester om 25 dagar.']);
    const { db } = workspace;
    const indexWrites = () =>
      (db.prepare('SELECT COUNT(*) AS n FROM chunks_fts_data').get() as { n: number }).n;
    const before = indexWrites();

    db.prepare(
      'UPDATE chunks SET text = text, context = context, source_ref = source_ref, ordinal = 5 WHERE id = ?',
    ).run(id);

    expect(indexWrites()).toBe(before);
  });
});
