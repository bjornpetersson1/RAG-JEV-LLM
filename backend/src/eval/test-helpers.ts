import { createTestDatabase } from '../db/test-helpers.js';
import type { EvalQuery } from './queries.js';

/** A database with one law (two chunks, the first tagged `uppsagning`) and one ruling (one chunk). */
export function createEvalDatabase() {
  const database = createTestDatabase('eval-');
  database.db.exec(`
    INSERT INTO documents (id, type, title, identifier, fetched_at, raw_text, structure) VALUES
      (1, 'law', 'Lag (1982:80) om anställningsskydd', 'SFS 1982:80', '2026-10-11', '', '{}'),
      (2, 'ruling', 'Konkurrensklausul', 'AD 2015 nr 8', '2026-10-11', '', '{}');
    INSERT INTO chunks (id, document_id, ordinal, source_ref, text, context, token_count) VALUES
      (11, 1, 0, 'SFS 1982:80 7 §', 'Uppsägning ska vara sakligt grundad.', '', 10),
      (12, 1, 1, 'SFS 1982:80 11 §', 'Uppsägningstiden är minst en månad.', '', 10),
      (21, 2, 0, 'AD 2015 nr 8, Domskäl, del 1/5', 'Konkurrensklausulen är oskälig.', '', 10);
    INSERT INTO tags (id, slug, label, description, area) VALUES
      (1, 'uppsagning', 'Uppsägning', 'uppsägning', 'anstallning');
    INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at) VALUES
      (11, 1, 'fake', 'v1', '2026-10-11');
  `);
  return database;
}

/** `count` valid queries: the first half employment, the rest NDA, every third with a template. */
export function evalQueries(count = 20): EvalQuery[] {
  return Array.from({ length: count }, (_, i) => {
    const kind = i < count / 2 ? 'employment' : 'nda';
    return {
      id: `q${i + 1}`,
      kind,
      instruction: `Instruktion ${i + 1}`,
      ...(i % 3 === 0 ? { template: kind } : {}),
      relevant: [
        { document: 'SFS 1982:80', sourceRef: 'SFS 1982:80 7 §', grade: 'central' as const },
      ],
    };
  });
}
