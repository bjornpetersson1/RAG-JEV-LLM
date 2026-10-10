import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { importLaws } from './import-laws.js';
import { writeManifest, type ManifestEntry } from './manifest.js';
import type { LawStructure } from './structure.js';

const TODAY = '2026-10-10';
const FETCHED_AT = '2026-10-10T08:00:00.000Z';

function lawEntry(sfsNumber: string): ManifestEntry {
  return {
    type: 'law',
    identifier: `SFS ${sfsNumber}`,
    sourceUrl: `https://rkrattsbaser.gov.se/sfst?bet=${sfsNumber}`,
    fetchedAt: FETCHED_AT,
    file: `laws/SFS-${sfsNumber.replace(':', '-')}.html`,
  };
}

const FHL = lawEntry('2018:558');
const DL = lawEntry('2008:567');

describe('importLaws', () => {
  let dir: string;
  let rawDir: string;
  let db: DatabaseSync;
  let log: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'import-laws-'));
    rawDir = join(dir, 'raw');
    mkdirSync(join(rawDir, 'laws'), { recursive: true });
    copyFixture('law-sfs-2018-558.html', FHL);
    copyFixture('law-sfs-2008-567.html', DL);
    db = openDatabase(join(dir, 'test.db'));
    migrate(db);
    log = [];
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function copyFixture(name: string, entry: ManifestEntry): void {
    copyFileSync(new URL(`./fixtures/${name}`, import.meta.url), join(rawDir, entry.file));
  }

  function run(entries: ManifestEntry[]) {
    writeManifest(rawDir, { documents: entries });
    return importLaws({ db, rawDir, today: TODAY, log: (message) => log.push(message) });
  }

  function documents() {
    return db.prepare('SELECT * FROM documents ORDER BY id').all();
  }

  it('stores title, SFS number, dates, source and structure', () => {
    const result = run([FHL, DL]);

    expect(result).toEqual({ inserted: ['SFS 2018:558', 'SFS 2008:567'], updated: [], failed: [] });
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

    expect(second).toEqual({ inserted: [], updated: ['SFS 2018:558', 'SFS 2008:567'], failed: [] });
    const after = documents();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after[0]!.fetched_at).toBe('2026-10-11T08:00:00.000Z');
  });

  it('logs a broken law and imports the rest', () => {
    const broken = lawEntry('1982:80');
    writeFileSync(join(rawDir, broken.file), '<html>Sökningen gav inga träffar</html>');
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
    expect(() => importLaws({ db, rawDir: join(dir, 'empty'), today: TODAY })).toThrow(
      'run npm run data:fetch first',
    );
  });
});
