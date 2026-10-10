import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncVocabulary } from './sync-vocabulary.js';
import { createTaggingWorkspace } from './test-helpers.js';
import type { VocabularyTag } from './vocabulary.js';

describe('syncVocabulary', () => {
  let workspace: ReturnType<typeof createTaggingWorkspace>;

  const tags: VocabularyTag[] = [
    { slug: 'lon', label: 'Lön', description: 'lön och lönevillkor', area: 'lon' },
    { slug: 'vite', label: 'Vite', description: 'avtalat vite', area: 'skadestand' },
    { slug: 'bonus', label: 'Bonus', description: 'bonus', area: 'lon' },
  ];

  beforeEach(() => {
    workspace = createTaggingWorkspace();
  });

  afterEach(() => {
    workspace.remove();
  });

  const storedTags = () =>
    workspace.db.prepare('SELECT slug, label, description, area FROM tags ORDER BY slug').all();

  const linkTag = (chunkId: number, slug: string) =>
    workspace.db
      .prepare(
        `INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at)
         SELECT ?, id, 'fake', 'v1', '2026-10-10T08:00:00.000Z' FROM tags WHERE slug = ?`,
      )
      .run(chunkId, slug);

  it('inserts every tag into an empty table', () => {
    expect(syncVocabulary(workspace.db, tags)).toEqual({
      inserted: 3,
      updated: 0,
      deleted: 0,
      unchanged: 0,
    });
    expect(storedTags()).toEqual([...tags].sort((a, b) => a.slug.localeCompare(b.slug)));
  });

  it('changes nothing when run again', () => {
    syncVocabulary(workspace.db, tags);
    const ids = workspace.db.prepare('SELECT id, slug FROM tags ORDER BY id').all();

    expect(syncVocabulary(workspace.db, tags)).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      unchanged: 3,
    });
    expect(workspace.db.prepare('SELECT id, slug FROM tags ORDER BY id').all()).toEqual(ids);
  });

  it('updates a changed label, description or area by slug and keeps its id and links', () => {
    syncVocabulary(workspace.db, tags);
    const [chunkId] = workspace.addChunks('SFS 1982:80', ['Lön betalas månadsvis.']);
    linkTag(chunkId, 'lon');
    const idBefore = workspace.db.prepare("SELECT id FROM tags WHERE slug = 'lon'").get();
    const changed = tags.map((tag) =>
      tag.slug === 'lon'
        ? { ...tag, label: 'Lön och lönevillkor', area: 'anstallning' as const }
        : tag,
    );

    expect(syncVocabulary(workspace.db, changed)).toEqual({
      inserted: 0,
      updated: 1,
      deleted: 0,
      unchanged: 2,
    });
    expect(
      workspace.db.prepare("SELECT id, label, area FROM tags WHERE slug = 'lon'").get(),
    ).toEqual({
      ...idBefore,
      label: 'Lön och lönevillkor',
      area: 'anstallning',
    });
    expect(workspace.db.prepare('SELECT COUNT(*) AS n FROM chunk_tags').get()).toEqual({ n: 1 });
  });

  it('deletes a removed tag together with its chunk links', () => {
    syncVocabulary(workspace.db, tags);
    const [chunkId] = workspace.addChunks('SFS 1982:80', ['Vite om 100 000 kronor.']);
    linkTag(chunkId, 'vite');
    linkTag(chunkId, 'lon');

    expect(
      syncVocabulary(
        workspace.db,
        tags.filter((tag) => tag.slug !== 'vite'),
      ),
    ).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 1,
      unchanged: 2,
    });
    expect(storedTags().map((tag) => tag.slug)).toEqual(['bonus', 'lon']);
    expect(
      workspace.db
        .prepare('SELECT t.slug FROM chunk_tags ct JOIN tags t ON t.id = ct.tag_id')
        .all(),
    ).toEqual([{ slug: 'lon' }]);
  });

  it('rejects a repeated slug without changing anything', () => {
    syncVocabulary(workspace.db, tags);

    expect(() => syncVocabulary(workspace.db, [{ ...tags[0], label: 'Ny' }, tags[0]])).toThrow(
      'Duplicate tag slug lon',
    );
    expect(storedTags()).toHaveLength(3);
  });

  it('applies nothing when the sync fails part-way', () => {
    syncVocabulary(workspace.db, tags);
    // The new tag violates NOT NULL after the update of 'lon' has run.
    const broken = [
      { ...tags[0], label: 'Ny' },
      { ...tags[1], slug: 'ny', description: null as never },
    ];

    expect(() => syncVocabulary(workspace.db, broken)).toThrow();
    expect(storedTags()).toHaveLength(3);
    expect(workspace.db.prepare("SELECT label FROM tags WHERE slug = 'lon'").get()).toEqual({
      label: 'Lön',
    });
  });
});
