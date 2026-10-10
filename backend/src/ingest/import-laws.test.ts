import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importLaws } from './import-laws.js';
import type { ManifestEntry } from './manifest.js';
import type { LawStructure } from './structure.js';
import { FETCHED_AT, createImportWorkspace, manifestEntry } from './test-helpers.js';

const TODAY = '2026-10-10';

function lawEntry(sfsNumber: string): ManifestEntry {
  return manifestEntry({ type: 'law', identifier: `SFS ${sfsNumber}`, title: '', sfsNumber });
}

const FHL = lawEntry('2018:558');
const DL = lawEntry('2008:567');

describe('importLaws', () => {
  let workspace: ReturnType<typeof createImportWorkspace>;
  let db: DatabaseSync;
  let log: string[];

  beforeEach(() => {
    workspace = createImportWorkspace();
    workspace.copyFixture('law-sfs-2018-558.html', FHL);
    workspace.copyFixture('law-sfs-2008-567.html', DL);
    db = workspace.db;
    log = [];
  });

  afterEach(() => workspace.remove());

  function run(entries: ManifestEntry[]) {
    workspace.writeManifest(entries);
    return importLaws({
      db,
      rawDir: workspace.rawDir,
      today: TODAY,
      log: (message) => log.push(message),
    });
  }

  const documents = () => workspace.documents();

  it('stores title, SFS number, dates, source and structure', () => {
    const result = run([FHL, DL]);

    expect(result).toEqual({
      inserted: ['SFS 2018:558', 'SFS 2008:567'],
      updated: [],
      failed: [],
      flagged: [],
    });
    const [fhl] = documents();
    expect(fhl).toMatchObject({
      type: 'law',
      title: 'Lag (2018:558) om företagshemligheter',
      identifier: 'SFS 2018:558',
      court: null,
      date: '2018-05-25',
      consolidated_through: '2025:1281',
      source_url: 'https://rkrattsbaser.gov.se/sfst?bet=2018:558',
      fetched_at: FETCHED_AT,
    });
    expect(fhl!.raw_text).toMatch(/^Lagens innehåll\n\n1 § Lagen innehåller/);
    const structure = JSON.parse(String(fhl!.structure)) as LawStructure;
    expect(structure.chapters[0]!.sections).toHaveLength(4);
  });

  it('logs chapters, sections and transitional entries per law', () => {
    run([DL]);

    expect(log).toEqual([
      'Inserted SFS 2008:567: 3 chapters, 11 sections, 2 transitional entries (left out: 1 not in force)',
    ]);
  });

  it('updates in place on a second run', () => {
    run([FHL, DL]);
    const before = documents();
    const second = run([{ ...FHL, fetchedAt: '2026-10-11T08:00:00.000Z' }, DL]);

    expect(second).toEqual({
      inserted: [],
      updated: ['SFS 2018:558', 'SFS 2008:567'],
      failed: [],
      flagged: [],
    });
    const after = documents();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after[0]!.fetched_at).toBe('2026-10-11T08:00:00.000Z');
  });

  it('logs a broken law and imports the rest', () => {
    const broken = lawEntry('1982:80');
    workspace.writeRaw(broken, '<html>Sökningen gav inga träffar</html>');
    const missing = lawEntry('1977:480');

    const result = run([broken, FHL, missing]);

    expect(result.inserted).toEqual(['SFS 2018:558']);
    expect(result.failed).toEqual([
      { identifier: 'SFS 1982:80', reason: 'No law title found' },
      { identifier: 'SFS 1977:480', reason: expect.stringContaining('ENOENT') },
    ]);
    expect(log).toContain('Failed SFS 1982:80: No law title found');
    expect(documents()).toHaveLength(1);
  });

  it('rejects a page for another law than the manifest says', () => {
    const result = run([{ ...FHL, identifier: 'SFS 1982:80' }]);

    expect(result.failed).toEqual([
      { identifier: 'SFS 1982:80', reason: 'The page is for SFS 2018:558' },
    ]);
  });

  it('ignores rulings in the manifest', () => {
    const ruling: ManifestEntry = { ...FHL, type: 'ruling', identifier: 'AD 2024 nr 13' };

    expect(run([ruling]).inserted).toEqual([]);
  });

  it('asks for data:fetch when there is no manifest', () => {
    expect(() => importLaws({ db, rawDir: join(workspace.dir, 'empty'), today: TODAY })).toThrow(
      'run npm run data:fetch first',
    );
  });
});
