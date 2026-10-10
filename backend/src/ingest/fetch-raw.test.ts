import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRaw, rawFilePath, sourceUrl, type FetchRawOptions } from './fetch-raw.js';
import { readManifest } from './manifest.js';
import type { LawSelection, RulingSelection } from './selection.js';

const LAW: LawSelection = {
  type: 'law',
  identifier: 'SFS 1982:80',
  title: 'Lag (1982:80) om anställningsskydd',
  sfsNumber: '1982:80',
};
const RULING: RulingSelection = {
  type: 'ruling',
  identifier: 'AD 2024 nr 13',
  title: 'Företagshemligheter på ett HVB-hem',
  publicationId: 'eebb46ca-787b-4613-a936-0dcc40e3cb8a',
};
const BROKEN: RulingSelection = {
  type: 'ruling',
  identifier: 'NJA 2015 s. 741',
  title: 'Partneravtalet',
  publicationId: '187ddcee-2d7d-4c0e-9496-3804520c6c32',
};

// The SFST page encodes non-ASCII characters as entities, as the real page does.
const LAW_PAGE =
  '<html><span class="bold">Lag (1982:80) om anst&#228;llningsskydd</span><div>1 &#167; …</div></html>';
const RULING_RECORD = JSON.stringify({ id: RULING.publicationId, innehall: '<p>Domskäl</p>' });

const FIRST_RUN = new Date('2026-10-10T08:00:00.000Z');
const SECOND_RUN = new Date('2026-10-11T08:00:00.000Z');

/** A fetch fake serving the law page and the ruling record; any other URL is a 404. */
function createSourceFetch(overrides: Record<string, () => Response> = {}) {
  const responses: Record<string, () => Response> = {
    [sourceUrl(LAW)]: () => new Response(LAW_PAGE),
    [sourceUrl(RULING)]: () => new Response(RULING_RECORD),
    ...overrides,
  };
  return vi.fn<typeof fetch>(async (url) => {
    const respond = responses[String(url)];
    return respond ? respond() : new Response('not found', { status: 404 });
  });
}

describe('fetchRaw', () => {
  let rawDir: string;
  let log: string[];

  beforeEach(() => {
    rawDir = join(mkdtempSync(join(tmpdir(), 'raw-')), 'raw');
    log = [];
  });

  afterEach(() => {
    rmSync(join(rawDir, '..'), { recursive: true, force: true });
  });

  function run(options: Partial<FetchRawOptions>) {
    return fetchRaw({
      selection: [LAW, RULING],
      rawDir,
      fetch: createSourceFetch(),
      delayMs: 0,
      now: () => FIRST_RUN,
      log: (message) => log.push(message),
      ...options,
    });
  }

  it('stores a law page and a ruling record as fetched', async () => {
    const fetchFn = createSourceFetch();

    const result = await run({ fetch: fetchFn });

    expect(result).toEqual({
      fetched: ['SFS 1982:80', 'AD 2024 nr 13'],
      skipped: [],
      failed: [],
    });
    expect(readFileSync(join(rawDir, 'laws/SFS-1982-80.html'), 'utf8')).toBe(LAW_PAGE);
    expect(readFileSync(join(rawDir, 'rulings/AD-2024-nr-13.json'), 'utf8')).toBe(RULING_RECORD);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://rkrattsbaser.gov.se/sfst?bet=1982:80',
      expect.objectContaining({
        headers: { 'user-agent': expect.stringContaining('RAG-JEV-LLM') },
      }),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar/eebb46ca-787b-4613-a936-0dcc40e3cb8a',
      expect.anything(),
    );
  });

  it('writes a manifest entry per fetched document', async () => {
    await run({});

    expect(readManifest(rawDir)).toEqual({
      documents: [
        {
          type: 'law',
          identifier: 'SFS 1982:80',
          file: 'laws/SFS-1982-80.html',
          sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1982:80',
          fetchedAt: FIRST_RUN.toISOString(),
        },
        {
          type: 'ruling',
          identifier: 'AD 2024 nr 13',
          file: 'rulings/AD-2024-nr-13.json',
          sourceUrl:
            'https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar/eebb46ca-787b-4613-a936-0dcc40e3cb8a',
          fetchedAt: FIRST_RUN.toISOString(),
        },
      ],
    });
  });

  it('logs a failed document and fetches the rest', async () => {
    const result = await run({ selection: [BROKEN, LAW, RULING] });

    expect(result.fetched).toEqual(['SFS 1982:80', 'AD 2024 nr 13']);
    expect(result.failed).toEqual([
      { identifier: 'NJA 2015 s. 741', reason: expect.stringContaining('HTTP 404') },
    ]);
    expect(log).toContain(`Failed NJA 2015 s. 741: ${result.failed[0]!.reason}`);
    expect(existsSync(join(rawDir, rawFilePath(BROKEN)))).toBe(false);
    expect(readManifest(rawDir)?.documents.map((entry) => entry.identifier)).toEqual([
      'SFS 1982:80',
      'AD 2024 nr 13',
    ]);
  });

  it.each([
    [
      'a ruling without full text',
      RULING,
      JSON.stringify({ id: RULING.publicationId, innehall: '' }),
      'no HTML full text',
    ],
    ['a ruling response that is not JSON', RULING, '<html>error</html>', 'not JSON'],
    ['a ruling response that is JSON null', RULING, 'null', 'not a JSON object'],
    [
      'a different ruling record',
      RULING,
      JSON.stringify({ id: 'other', innehall: '<p>x</p>' }),
      'not the requested',
    ],
    [
      'a law page without the law title',
      LAW,
      '<html>Sökningen gav inga träffar</html>',
      'law title',
    ],
  ])('counts %s as failed', async (_, document, body, reason) => {
    const result = await run({
      selection: [document],
      fetch: createSourceFetch({
        [sourceUrl(document)]: () => new Response(body),
      }),
    });

    expect(result.failed).toEqual([
      { identifier: document.identifier, reason: expect.stringContaining(reason) },
    ]);
    expect(existsSync(join(rawDir, rawFilePath(document)))).toBe(false);
  });

  it('counts a network error as failed', async () => {
    const result = await run({
      selection: [LAW],
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
      }),
    });

    expect(result.failed).toEqual([
      { identifier: 'SFS 1982:80', reason: 'fetch failed: getaddrinfo ENOTFOUND' },
    ]);
  });

  it('skips documents that are already fetched and keeps their manifest entries', async () => {
    await run({});
    const fetchFn = createSourceFetch();

    const result = await run({ fetch: fetchFn, now: () => SECOND_RUN });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual({ fetched: [], skipped: ['SFS 1982:80', 'AD 2024 nr 13'], failed: [] });
    expect(log).toContain('Skipped SFS 1982:80: already fetched');
    expect(readManifest(rawDir)?.documents.map((entry) => entry.fetchedAt)).toEqual([
      FIRST_RUN.toISOString(),
      FIRST_RUN.toISOString(),
    ]);
  });

  it('describes a raw file that is missing from the manifest', async () => {
    mkdirSync(join(rawDir, 'laws'), { recursive: true });
    writeFileSync(join(rawDir, 'laws/SFS-1982-80.html'), LAW_PAGE);

    await run({ selection: [LAW] });

    expect(readManifest(rawDir)?.documents).toEqual([
      expect.objectContaining({ identifier: 'SFS 1982:80', fetchedAt: expect.any(String) }),
    ]);
  });

  it('fetches everything again with force', async () => {
    await run({});
    const fetchFn = createSourceFetch();

    const result = await run({
      fetch: fetchFn,
      now: () => SECOND_RUN,
      force: true,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.fetched).toEqual(['SFS 1982:80', 'AD 2024 nr 13']);
    expect(readManifest(rawDir)?.documents.map((entry) => entry.fetchedAt)).toEqual([
      SECOND_RUN.toISOString(),
      SECOND_RUN.toISOString(),
    ]);
  });

  it('keeps the earlier file and entry when a forced fetch fails', async () => {
    await run({ selection: [LAW] });

    const result = await run({
      selection: [LAW],
      force: true,
      now: () => SECOND_RUN,
      fetch: vi.fn<typeof fetch>(async () => new Response('', { status: 503 })),
    });

    expect(result.failed).toHaveLength(1);
    expect(readFileSync(join(rawDir, 'laws/SFS-1982-80.html'), 'utf8')).toBe(LAW_PAGE);
    expect(readManifest(rawDir)?.documents).toEqual([
      expect.objectContaining({ identifier: 'SFS 1982:80', fetchedAt: FIRST_RUN.toISOString() }),
    ]);
  });

  it('keeps a raw file without a manifest entry when a forced fetch fails', async () => {
    mkdirSync(join(rawDir, 'laws'), { recursive: true });
    writeFileSync(join(rawDir, 'laws/SFS-1982-80.html'), LAW_PAGE);

    await run({
      selection: [LAW],
      force: true,
      fetch: vi.fn<typeof fetch>(async () => new Response('', { status: 503 })),
    });

    expect(readManifest(rawDir)?.documents).toEqual([
      expect.objectContaining({ identifier: 'SFS 1982:80', file: 'laws/SFS-1982-80.html' }),
    ]);
  });

  it('fetches again when the source URL of a document has changed', async () => {
    await run({ selection: [RULING] });
    const corrected = { ...RULING, publicationId: '11111111-2222-3333-4444-555555555555' };
    const record = JSON.stringify({ id: corrected.publicationId, innehall: '<p>Domslut</p>' });

    const result = await run({
      selection: [corrected],
      now: () => SECOND_RUN,
      fetch: createSourceFetch({ [sourceUrl(corrected)]: () => new Response(record) }),
    });

    expect(result.fetched).toEqual(['AD 2024 nr 13']);
    expect(readFileSync(join(rawDir, rawFilePath(corrected)), 'utf8')).toBe(record);
    expect(readManifest(rawDir)?.documents).toEqual([
      expect.objectContaining({
        sourceUrl: sourceUrl(corrected),
        fetchedAt: SECOND_RUN.toISOString(),
      }),
    ]);
  });

  it('saves the manifest after each fetched document', async () => {
    const manifests: (string[] | undefined)[] = [];
    const sleep = vi.fn(async () => {
      manifests.push(readManifest(rawDir)?.documents.map((entry) => entry.identifier));
    });

    await run({ sleep });

    expect(manifests).toEqual([['SFS 1982:80']]);
  });

  it('accepts a law title written with non-breaking spaces', async () => {
    const page = '<span class="bold">Lag (1982:80) om&nbsp;anst&#228;llningsskydd</span>';

    const result = await run({
      selection: [LAW],
      fetch: createSourceFetch({ [sourceUrl(LAW)]: () => new Response(page) }),
    });

    expect(result.fetched).toEqual(['SFS 1982:80']);
  });

  it('rejects two identifiers that map to the same raw file', async () => {
    const lookalike = { ...BROKEN, identifier: 'NJA 2015 s 741' };

    await expect(run({ selection: [BROKEN, lookalike] })).rejects.toThrow(
      'NJA 2015 s. 741 and NJA 2015 s 741 would both be stored as rulings/NJA-2015-s-741.json',
    );
  });

  it('pauses between requests', async () => {
    const sleep = vi.fn(async () => {});

    await run({ delayMs: 250, sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});

describe('rawFilePath', () => {
  it('makes the identifier safe for the file system', () => {
    expect(rawFilePath(LAW)).toBe('laws/SFS-1982-80.html');
    expect(rawFilePath(BROKEN)).toBe('rulings/NJA-2015-s-741.json');
  });
});
