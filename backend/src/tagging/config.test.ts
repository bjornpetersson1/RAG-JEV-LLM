import { describe, expect, it } from 'vitest';
import { loadTaggingConfig } from './config.js';

describe('loadTaggingConfig', () => {
  it('defaults to 4 chunks at a time', () => {
    expect(loadTaggingConfig({})).toEqual({ concurrency: 4 });
    expect(loadTaggingConfig({ TAGGER_CONCURRENCY: ' ' })).toEqual({ concurrency: 4 });
  });

  it('reads TAGGER_CONCURRENCY', () => {
    expect(loadTaggingConfig({ TAGGER_CONCURRENCY: '8' })).toEqual({ concurrency: 8 });
  });

  it.each(['0', '-1', '2.5', 'many'])('rejects TAGGER_CONCURRENCY=%j', (value) => {
    expect(() => loadTaggingConfig({ TAGGER_CONCURRENCY: value })).toThrow(
      `Invalid TAGGER_CONCURRENCY "${value}": expected a positive integer`,
    );
  });
});
