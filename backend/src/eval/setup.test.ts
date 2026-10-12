import { afterEach, describe, expect, it } from 'vitest';
import { createEvalSetup } from './setup.js';
import { createEvalDatabase } from './test-helpers.js';

const logger = { info() {}, warn() {}, error() {} };

describe('createEvalSetup', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('ignores RERANK_TOP_K and keeps every relevant chunk', async () => {
    database = createEvalDatabase();
    // Every chunk is relevant at threshold 0; RERANK_TOP_K=0 would fail if it were read.
    const env = { LLM_PROVIDER: 'fake', JUDGE_THRESHOLD: '0', RERANK_TOP_K: '0' };

    const setup = createEvalSetup(database.db, env, logger);
    const chunks = setup.loadChunks(['11', '12', '21']);
    const result = await setup.judge('tags+llm', 'Uppsägning', chunks);

    expect(result.ranked).toHaveLength(3);
  });

  it('judges tags+jev with the llm reranker when there is no JEV key', () => {
    database = createEvalDatabase();

    const setup = createEvalSetup(database.db, { LLM_PROVIDER: 'fake' }, logger);

    expect(setup.judges['tags+jev']).toEqual(setup.judges['tags+llm']);
    expect(setup.judges['tags+jev']).toMatchObject({ name: 'llm', model: 'fake' });
  });
});
