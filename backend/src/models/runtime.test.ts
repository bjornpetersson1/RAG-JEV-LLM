import { describe, expect, it } from 'vitest';
import { inBatches } from './runtime.js';

describe('inBatches', () => {
  it('slices into consecutive batches, the last one shorter', () => {
    expect([...inBatches(['a', 'b', 'c', 'd', 'e'], 2)]).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('gives no batch for no items', () => {
    expect([...inBatches([], 8)]).toEqual([]);
  });
});
