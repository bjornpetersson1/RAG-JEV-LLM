import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../repo-root.js';
import { loadLocalModelConfig } from './config.js';

describe('loadLocalModelConfig', () => {
  it('defaults to int8, batches of 8 and data/models.nosync in the repo', () => {
    expect(loadLocalModelConfig({}, 'EMBEDDER')).toEqual({
      dtype: 'int8',
      batchSize: 8,
      cacheDir: join(REPO_ROOT, 'data/models.nosync'),
    });
  });

  it('reads the prefixed settings and the cache directory', () => {
    expect(
      loadLocalModelConfig(
        { EMBEDDER_DTYPE: 'fp32', EMBEDDER_BATCH_SIZE: '4', MODEL_CACHE_DIR: '/tmp/models' },
        'EMBEDDER',
      ),
    ).toEqual({ dtype: 'fp32', batchSize: 4, cacheDir: '/tmp/models' });
  });

  it.each([
    [{ EMBEDDER_DTYPE: 'fp16' }, 'Invalid EMBEDDER_DTYPE "fp16": expected int8 or fp32'],
    [{ EMBEDDER_BATCH_SIZE: '0' }, 'Invalid EMBEDDER_BATCH_SIZE "0"'],
  ])('rejects %o', (env, message) => {
    expect(() => loadLocalModelConfig(env, 'EMBEDDER')).toThrow(message);
  });
});
