import { describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_CONFIG, loadChunkConfig } from './chunk-config.js';

describe('loadChunkConfig', () => {
  it('uses 2000 and 200 when unset or empty', () => {
    expect(loadChunkConfig({})).toEqual({ maxChars: 2000, minChars: 200 });
    expect(loadChunkConfig({ CHUNK_MAX_CHARS: ' ', CHUNK_MIN_CHARS: '' })).toEqual(
      DEFAULT_CHUNK_CONFIG,
    );
  });

  it('reads both settings', () => {
    expect(loadChunkConfig({ CHUNK_MAX_CHARS: '300', CHUNK_MIN_CHARS: '50' })).toEqual({
      maxChars: 300,
      minChars: 50,
    });
  });

  it.each(['0', '-5', '1.5', 'many', '2e3', '0x7D0', '2000.0'])(
    'rejects CHUNK_MAX_CHARS=%s',
    (value) => {
      expect(() => loadChunkConfig({ CHUNK_MAX_CHARS: value })).toThrow(
        `Invalid CHUNK_MAX_CHARS "${value}": expected a positive integer`,
      );
    },
  );

  it('rejects a minimum that is not below the maximum', () => {
    expect(() => loadChunkConfig({ CHUNK_MAX_CHARS: '300', CHUNK_MIN_CHARS: '300' })).toThrow(
      'CHUNK_MIN_CHARS (300) must be less than CHUNK_MAX_CHARS (300)',
    );
  });
});
