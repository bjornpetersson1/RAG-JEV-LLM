import { describe, expect, it } from 'vitest';
import { rejectRemovedSettings, REMOVED_SETTINGS } from './removed-settings.js';

describe('rejectRemovedSettings', () => {
  it.each([{}, { RETRIEVER: 'tags', RERANKER: 'llm', EMBEDDER: ' ' }])('accepts %o', (env) => {
    expect(() => rejectRemovedSettings(env)).not.toThrow();
  });

  it.each([
    ['RETRIEVER', 'bge'],
    ['RETRIEVER', 'both'],
    ['RERANKER', 'bge'],
    ['RERANKER', 'minilm'],
    ['RERANKER', 'qwen3'],
  ])('rejects the removed %s=%s by name', (key, value) => {
    expect(() => rejectRemovedSettings({ [key]: value })).toThrow(
      `${key}=${value} was removed: the local models were removed (E10-1); remove it from .env`,
    );
  });

  it.each(REMOVED_SETTINGS)('rejects the removed setting %s by name', (key) => {
    expect(() => rejectRemovedSettings({ [key]: '1' })).toThrow(
      `${key} was removed: the local models were removed (E10-1); remove ${key} from .env`,
    );
  });
});
