import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_CONFIG, loadSearchConfig, tagIndexBuilder } from './config.js';

describe('loadSearchConfig', () => {
  it('defaults to the roaring index and the default bloom settings', () => {
    expect(loadSearchConfig({})).toEqual(DEFAULT_SEARCH_CONFIG);
    expect(DEFAULT_SEARCH_CONFIG).toEqual({
      tagIndex: 'roaring',
      bloom: { bits: 128, hashes: 6, verify: true },
      minTagCandidates: 10,
      maxCandidates: 30,
    });
  });

  it('reads TAG_INDEX and the bloom settings', () => {
    expect(
      loadSearchConfig({
        TAG_INDEX: 'bloom',
        BLOOM_BITS: '256',
        BLOOM_HASHES: '4',
        BLOOM_VERIFY: 'false',
      }),
    ).toMatchObject({ tagIndex: 'bloom', bloom: { bits: 256, hashes: 4, verify: false } });
  });

  it('reads MIN_TAG_CANDIDATES and MAX_CANDIDATES', () => {
    expect(loadSearchConfig({ MIN_TAG_CANDIDATES: '5', MAX_CANDIDATES: '50' })).toMatchObject({
      minTagCandidates: 5,
      maxCandidates: 50,
    });
  });

  it.each([
    [{ TAG_INDEX: 'bitmap' }, 'Invalid TAG_INDEX "bitmap": expected roaring or bloom'],
    [{ BLOOM_BITS: '0' }, 'Invalid BLOOM_BITS "0": expected a positive integer'],
    [{ BLOOM_HASHES: 'six' }, 'Invalid BLOOM_HASHES "six": expected a positive integer'],
    [
      { BLOOM_BITS: '4', BLOOM_HASHES: '5' },
      'Invalid BLOOM_HASHES 5: expected at most BLOOM_BITS (4)',
    ],
    [{ BLOOM_VERIFY: 'yes' }, 'Invalid BLOOM_VERIFY "yes": expected true or false'],
    [{ MIN_TAG_CANDIDATES: '0' }, 'Invalid MIN_TAG_CANDIDATES "0": expected a positive integer'],
    [{ MAX_CANDIDATES: '3.5' }, 'Invalid MAX_CANDIDATES "3.5": expected a positive integer'],
    [
      { MIN_TAG_CANDIDATES: '40' },
      'Invalid MIN_TAG_CANDIDATES 40: expected at most MAX_CANDIDATES (30)',
    ],
  ])('rejects %o', (env, message) => {
    expect(() => loadSearchConfig(env)).toThrow(message);
  });
});

describe('tagIndexBuilder', () => {
  const chunkTags = [{ chunkId: 1, slug: 'lon' }];

  it('builds the implementation TAG_INDEX names', () => {
    const roaring = tagIndexBuilder(loadSearchConfig({}))(chunkTags);
    const bloom = tagIndexBuilder(loadSearchConfig({ TAG_INDEX: 'bloom', BLOOM_BITS: '64' }))(
      chunkTags,
    );

    expect(roaring.description).toEqual({ implementation: 'roaring' });
    expect(bloom.description).toMatchObject({ implementation: 'bloom', bits: 64, verify: true });
    roaring.dispose();
    bloom.dispose();
  });
});
