import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SELECTION_PATH } from './paths.js';
import { loadSelection } from './selection.js';

describe('the committed selection', () => {
  const selection = loadSelection(SELECTION_PATH);
  const laws = selection.filter((document) => document.type === 'law');
  const rulings = selection.filter((document) => document.type === 'ruling');

  it('has the 11 laws from the spec', () => {
    expect(laws.map((law) => law.identifier)).toEqual(
      [
        '1982:80',
        '1915:218',
        '2018:558',
        '1977:480',
        '2008:567',
        '1982:673',
        '1976:580',
        '1995:584',
        '2018:218',
        '2002:293',
        '2012:854',
      ].map((number) => `SFS ${number}`),
    );
    for (const law of laws) expect(law.identifier).toBe(`SFS ${law.sfsNumber}`);
  });

  it('has 45 AD and 5 HD rulings', () => {
    expect(rulings).toHaveLength(50);
    expect(rulings.filter((ruling) => ruling.identifier.startsWith('AD '))).toHaveLength(45);
    expect(rulings.filter((ruling) => ruling.identifier.startsWith('NJA '))).toHaveLength(5);
  });
});

describe('loadSelection', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'selection-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function load(documents: unknown) {
    const path = join(dir, 'selection.json');
    writeFileSync(path, JSON.stringify({ documents }));
    return () => loadSelection(path);
  }

  it('rejects a duplicate identifier', () => {
    const law = { type: 'law', identifier: 'SFS 1982:80', title: 'LAS', sfsNumber: '1982:80' };

    expect(load([law, law])).toThrow('duplicate identifier SFS 1982:80');
  });

  it('rejects a document with a missing field or unknown type', () => {
    expect(load([{ type: 'ruling', identifier: 'AD 2024 nr 13', title: 'x' }])).toThrow(
      '"publicationId" must be a non-empty string',
    );
    expect(load([{ type: 'book', identifier: 'x', title: 'x' }])).toThrow(
      '"type" must be "law" or "ruling"',
    );
  });
});
