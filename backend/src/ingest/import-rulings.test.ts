import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importRulings } from './import-rulings.js';
import type { ManifestEntry } from './manifest.js';
import type { RulingStructure } from './structure.js';
import { FETCHED_AT, createImportWorkspace, manifestEntry } from './test-helpers.js';

function rulingEntry(identifier: string): ManifestEntry {
  return manifestEntry({ type: 'ruling', identifier, title: '', publicationId: identifier });
}

const AD = rulingEntry('AD 2024 nr 13');
const NJA = rulingEntry('NJA 2015 s. 741');

describe('importRulings', () => {
  let workspace: ReturnType<typeof createImportWorkspace>;
  let db: DatabaseSync;
  let log: string[];

  beforeEach(() => {
    workspace = createImportWorkspace();
    workspace.copyFixture('ruling-ad-2024-nr-13.json', AD);
    workspace.copyFixture('ruling-nja-2015-s-741.json', NJA);
    db = workspace.db;
    log = [];
  });

  afterEach(() => workspace.remove());

  function run(entries: ManifestEntry[]) {
    workspace.writeManifest(entries);
    return importRulings({ db, rawDir: workspace.rawDir, log: (message) => log.push(message) });
  }

  const documents = () => workspace.documents();

  it('stores court, reference, date, title, source and structure', () => {
    const result = run([AD, NJA]);

    expect(result).toEqual({
      inserted: ['AD 2024 nr 13', 'NJA 2015 s. 741'],
      updated: [],
      failed: [],
      flagged: [],
    });
    const [ad, nja] = documents();
    expect(ad).toMatchObject({
      type: 'ruling',
      identifier: 'AD 2024 nr 13',
      court: 'AD',
      date: '2024-02-14',
      title: 'En arbetstagares anställning på ett s.k. HVB-hem har upphört.',
      source_url: AD.sourceUrl,
      fetched_at: FETCHED_AT,
      consolidated_through: null,
    });
    expect(nja).toMatchObject({ identifier: 'NJA 2015 s. 741', court: 'HD', date: '2015-11-06' });
    const structure = JSON.parse(String(ad!.structure)) as RulingStructure;
    expect(structure.caseNumbers).toEqual(['B 116-22']);
    expect(ad!.raw_text).toMatch(/^Inledning\n\nNr 13\n\nA\.N\./);
  });

  it('logs the number of sections per ruling', () => {
    run([AD]);

    expect(log).toEqual(['Inserted AD 2024 nr 13: 7 sections, 5 sub-sections']);
  });

  it('updates in place on a second run', () => {
    run([AD, NJA]);
    const before = documents();
    const second = run([AD, NJA]);

    expect(second.updated).toEqual(['AD 2024 nr 13', 'NJA 2015 s. 741']);
    expect(documents().map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it('flags a ruling without recognised sections and still imports it', () => {
    const flagged = rulingEntry('AD 2024 nr 99');
    workspace.writeRaw(
      flagged,
      JSON.stringify({
        domstol: { domstolKod: 'ADO' },
        avgorandedatum: '2024-05-01',
        referatNummerLista: ['AD 2024 nr 99'],
        innehall: '<p>Nr 99</p><p>Arbetsdomstolen avskriver målet.</p>',
      }),
    );

    const result = run([flagged, AD]);

    expect(result.inserted).toEqual(['AD 2024 nr 99', 'AD 2024 nr 13']);
    expect(result.flagged).toEqual(['AD 2024 nr 99']);
    expect(log).toContain(
      'Flagged AD 2024 nr 99: No Domskäl or Domslut heading found; imported as one section',
    );
  });

  it('logs a record that cannot be imported and imports the rest', () => {
    const broken = rulingEntry('AD 2020 nr 1');
    workspace.writeRaw(broken, '{"domstol": {"domstolKod": "ADO"}}');
    const missing = rulingEntry('AD 2021 nr 2');

    const result = run([broken, AD, missing]);

    expect(result.inserted).toEqual(['AD 2024 nr 13']);
    expect(result.failed).toEqual([
      { identifier: 'AD 2020 nr 1', reason: 'No reference number' },
      { identifier: 'AD 2021 nr 2', reason: expect.stringContaining('ENOENT') },
    ]);
    expect(log).toContain('Failed AD 2020 nr 1: No reference number');
  });

  it('rejects a record for another ruling than the manifest says', () => {
    const result = run([{ ...AD, identifier: 'AD 2019 nr 35' }]);

    expect(result.failed).toEqual([
      { identifier: 'AD 2019 nr 35', reason: 'The record is for AD 2024 nr 13' },
    ]);
  });

  it('asks for data:fetch when there is no manifest', () => {
    expect(() => importRulings({ db, rawDir: join(workspace.dir, 'empty') })).toThrow(
      'run npm run data:fetch first',
    );
  });
});
