import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_CONFIG } from './chunk-config.js';
import { chunkDocuments, describeLengths } from './chunk-documents.js';
import { importLaws } from './import-laws.js';
import { importRulings } from './import-rulings.js';
import type { LawStructure } from './structure.js';
import { createImportWorkspace, manifestEntry } from './test-helpers.js';

const FHL = manifestEntry({
  type: 'law',
  identifier: 'SFS 2018:558',
  title: '',
  sfsNumber: '2018:558',
});
const AD = manifestEntry({
  type: 'ruling',
  identifier: 'AD 1994 nr 79',
  title: '',
  publicationId: 'AD 1994 nr 79',
});

interface ChunkRow {
  id: number;
  ordinal: number;
  source_ref: string;
  text: string;
  context: string;
  token_count: number;
}

describe('chunkDocuments', () => {
  let workspace: ReturnType<typeof createImportWorkspace>;
  let db: DatabaseSync;
  let log: string[];

  beforeEach(() => {
    workspace = createImportWorkspace();
    workspace.copyFixture('law-sfs-2018-558.html', FHL);
    workspace.copyFixture('ruling-ad-1994-nr-79.json', AD);
    workspace.writeManifest([FHL, AD]);
    db = workspace.db;
    const quiet = () => {};
    importLaws({ db, rawDir: workspace.rawDir, today: '2026-10-10', log: quiet });
    importRulings({ db, rawDir: workspace.rawDir, log: quiet });
    log = [];
  });

  afterEach(() => workspace.remove());

  const run = (identifier?: string) =>
    chunkDocuments({
      db,
      config: DEFAULT_CHUNK_CONFIG,
      identifier,
      log: (message) => log.push(message),
    });

  function chunksOf(identifier: string): ChunkRow[] {
    return db
      .prepare(
        `SELECT chunks.* FROM chunks JOIN documents ON documents.id = chunks.document_id
         WHERE documents.identifier = ? ORDER BY ordinal`,
      )
      .all(identifier) as unknown as ChunkRow[];
  }

  function tag(chunkId: number): void {
    db.prepare(
      `INSERT OR IGNORE INTO tags (slug, label, description, area) VALUES ('t', 'T', 'Tag', 'a')`,
    ).run();
    db.prepare(
      `INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at)
       SELECT ?, id, 'fake', 'v1', '2026-10-10T08:00:00.000Z' FROM tags WHERE slug = 't'`,
    ).run(chunkId);
    db.prepare(
      `UPDATE chunks SET tagged_model = 'fake', tagged_vocabulary_version = 'v1',
         tagged_at = '2026-10-10T08:00:00.000Z' WHERE id = ?`,
    ).run(chunkId);
  }

  const taggedModel = (chunkId: number) =>
    (
      db.prepare('SELECT tagged_model FROM chunks WHERE id = ?').get(chunkId) as {
        tagged_model: string | null;
      }
    ).tagged_model;

  const tagCount = (chunkId: number) =>
    (
      db.prepare('SELECT COUNT(*) AS n FROM chunk_tags WHERE chunk_id = ?').get(chunkId) as {
        n: number;
      }
    ).n;

  function editLaw(edit: (structure: LawStructure) => void): void {
    const row = db
      .prepare(`SELECT structure FROM documents WHERE identifier = 'SFS 2018:558'`)
      .get() as { structure: string };
    const structure = JSON.parse(row.structure) as LawStructure;
    edit(structure);
    db.prepare(`UPDATE documents SET structure = ? WHERE identifier = 'SFS 2018:558'`).run(
      JSON.stringify(structure),
    );
  }

  it('stores ordinals, references, context, text and token estimates', () => {
    const result = run();

    const law = chunksOf('SFS 2018:558');
    expect(law.map((chunk) => [chunk.ordinal, chunk.source_ref])).toEqual([
      [0, 'SFS 2018:558 1 §'],
      [1, 'SFS 2018:558 2 §'],
      [2, 'SFS 2018:558 3 §'],
      [3, 'SFS 2018:558 4 §'],
      [4, 'SFS 2018:558 övergångsbestämmelser 2018:558'],
    ]);
    expect(law[0]).toMatchObject({
      context: 'Lag (2018:558) om företagshemligheter › Lagens innehåll › 1 §',
      text: expect.stringMatching(/^1 § Lagen innehåller/),
      token_count: Math.ceil(law[0]!.text.length / 3.5),
    });
    const ruling = chunksOf('AD 1994 nr 79');
    expect(ruling.map((chunk) => chunk.ordinal)).toEqual(ruling.map((_, index) => index));
    expect(result).toMatchObject({ inserted: law.length + ruling.length, updated: 0, deleted: 0 });
  });

  it('logs chunks and min/median/max length per document', () => {
    run();

    expect(log[0]).toMatch(/^SFS 2018:558: 5 chunks, min\/median\/max \d+\/\d+\/\d+ characters$/);
    expect(log[1]).toMatch(/^AD 1994 nr 79: \d+ chunks, min\/median\/max/);
  });

  it('keeps ids and tags when nothing changed', () => {
    run();
    const before = chunksOf('SFS 2018:558');
    tag(before[1]!.id);

    const result = run();

    expect(chunksOf('SFS 2018:558').map((chunk) => chunk.id)).toEqual(
      before.map((chunk) => chunk.id),
    );
    expect(tagCount(before[1]!.id)).toBe(1);
    expect(result).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
    expect(result.unchanged).toBe(result.lengths.length);
  });

  it('keeps the id of a changed section but deletes its tags and tagging state', () => {
    run();
    const before = chunksOf('SFS 2018:558');
    tag(before[1]!.id);
    tag(before[2]!.id);
    editLaw((structure) => {
      structure.chapters[0]!.sections[1]!.paragraphs[0] = 'Ny lydelse.';
    });

    const result = run('SFS 2018:558');

    const after = chunksOf('SFS 2018:558');
    expect(after[1]).toMatchObject({
      id: before[1]!.id,
      text: '2 § Ny lydelse.\n\n' + after[1]!.text.split('\n\n').slice(1).join('\n\n'),
    });
    expect(tagCount(before[1]!.id)).toBe(0);
    expect(tagCount(before[2]!.id)).toBe(1);
    expect(taggedModel(before[1]!.id)).toBeNull();
    expect(taggedModel(before[2]!.id)).toBe('fake');
    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 4, deleted: 0 });
  });

  it('deletes the tags of a chunk whose context changed', () => {
    run();
    const before = chunksOf('SFS 2018:558');
    tag(before[0]!.id);
    editLaw((structure) => {
      structure.chapters[0]!.sections[0]!.heading = 'Ny rubrik';
    });

    const result = run('SFS 2018:558');

    expect(chunksOf('SFS 2018:558')[0]).toMatchObject({
      id: before[0]!.id,
      context: 'Lag (2018:558) om företagshemligheter › Ny rubrik › 1 §',
    });
    expect(tagCount(before[0]!.id)).toBe(0);
    expect(result).toMatchObject({ updated: 1, unchanged: 4 });
  });

  it('keeps the id and tags of a chunk whose reference changed but whose content did not', () => {
    run();
    const before = chunksOf('SFS 2018:558');
    tag(before[3]!.id);
    // As if the previous run had cited the same text differently, e.g. "del 2/3" before "del 2/4".
    db.prepare(`UPDATE chunks SET source_ref = 'SFS 2018:558 4 § (old)' WHERE id = ?`).run(
      before[3]!.id,
    );

    const result = run('SFS 2018:558');

    expect(chunksOf('SFS 2018:558')[3]).toMatchObject({
      id: before[3]!.id,
      source_ref: 'SFS 2018:558 4 §',
    });
    expect(tagCount(before[3]!.id)).toBe(1);
    expect(result).toMatchObject({ inserted: 0, deleted: 0, unchanged: 5 });
  });

  it('deletes the chunk of a removed section and inserts one for an added section', () => {
    run();
    const before = chunksOf('SFS 2018:558');
    editLaw((structure) => {
      const sections = structure.chapters[0]!.sections;
      sections.splice(2, 1);
      sections.push({ number: '5', heading: null, paragraphs: ['Femte.'], amendedBy: null });
    });

    const result = run('SFS 2018:558');

    const after = chunksOf('SFS 2018:558');
    expect(after.map((chunk) => chunk.source_ref)).toEqual([
      'SFS 2018:558 1 §',
      'SFS 2018:558 2 §',
      'SFS 2018:558 4 §',
      'SFS 2018:558 5 §',
      'SFS 2018:558 övergångsbestämmelser 2018:558',
    ]);
    expect(after.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(after.map((chunk) => chunk.id)).not.toContain(before[2]!.id);
    expect(result).toMatchObject({ inserted: 1, deleted: 1 });
  });

  it('skips a document without structure, reports it and chunks the rest', () => {
    db.prepare(`UPDATE documents SET structure = NULL WHERE identifier = 'SFS 2018:558'`).run();

    const result = run();

    expect(result.failed).toEqual([
      { identifier: 'SFS 2018:558', reason: 'No structure; import the document again' },
    ]);
    expect(log).toContain('Failed SFS 2018:558: No structure; import the document again');
    expect(chunksOf('AD 1994 nr 79').length).toBeGreaterThan(0);
  });

  it('rejects an unknown identifier', () => {
    expect(() => run('SFS 1999:1')).toThrow('No document with identifier SFS 1999:1');
  });
});

describe('describeLengths', () => {
  it('gives min, median and max', () => {
    expect(describeLengths([30, 10, 20])).toBe('min/median/max 10/20/30 characters');
    expect(describeLengths([10, 20, 30, 41])).toBe('min/median/max 10/25/41 characters');
    expect(describeLengths([])).toBe('no text');
  });
});
