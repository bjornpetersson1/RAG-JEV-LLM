import { afterEach, describe, expect, it } from 'vitest';
import { SILENT_LOGGER } from '../llm/client.js';
import { indexEmbeddings } from '../retrieval/index-embeddings.js';
import { createFakeEmbedder, FAKE_IDENTITY } from '../retrieval/test-helpers.js';
import { benchCompare } from './bench-compare.js';
import { createBenchSetup } from './bench-compare-setup.js';
import { resolveEvalQueries } from './queries.js';
import { createEvalDatabase, evalQueries } from './test-helpers.js';

describe('createBenchSetup', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  const ENV = {
    LLM_PROVIDER: 'fake',
    QUERY_TRANSLATOR_IMPL: 'llm',
    RERANKER: 'llm',
    REFERENCE_TOP_K: '2',
  };

  it('runs the main flow and the reference RAG from .env and measures both', async () => {
    database = createEvalDatabase();
    const { embedder, embedded } = createFakeEmbedder();
    await indexEmbeddings(database.db, embedder, FAKE_IDENTITY);
    const queries = resolveEvalQueries(evalQueries(), database.db).slice(0, 2);

    const { flows, warmUp } = createBenchSetup(
      database.db,
      { ...ENV, DATABASE_PATH: database.path },
      SILENT_LOGGER,
      embedder,
    );
    const indexed = embedded.length;
    await warmUp();
    const [main, reference] = await benchCompare(queries, flows, { runs: 2, draft: true });

    expect(embedded[indexed]).toBe('uppvärmning');
    expect(flows.map(({ configuration }) => configuration)).toEqual([
      'retriever tags · tag index roaring · translator fake fake · reranker llm fake · top 8 · ' +
        'generator fake fake',
      'retriever dense (fake-embedder int8) · top 2 · generator fake fake',
    ]);
    expect(main).toMatchObject({ flow: 'main', queries: 2, runs: 2, failures: 0 });
    expect(reference).toMatchObject({ flow: 'reference', queries: 2, drafts: 4, failures: 0 });
    expect(reference.measured?.relevance.precision).toBeGreaterThanOrEqual(0);
    expect(reference.measured?.sourceAccuracy).toBe(1);
  });
});
