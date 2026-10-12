// `npm run embed:smoke` (E8-2): embeds the query "7 § LAS" and two chunks with the configured
// embedder, LAS 7 § and the same section number in an unrelated law, and fails unless every vector
// is a 1,024-dimension unit vector and LAS 7 § is closer. The first run downloads the model.

import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { loadPassage } from '../models/passages.js';
import { createEmbedder } from './factory.js';

const QUERY = '7 § LAS';
const RIGHT = 'SFS 1982:80 7 §';
const UNRELATED = 'SFS 2018:218 1 kap. 7 §';
const DIMENSIONS = 1024;

try {
  process.exitCode = await withDatabase(async (db) => {
    const passages = [loadPassage(db, RIGHT), loadPassage(db, UNRELATED)];
    const embedder = createEmbedder(process.env);
    const [query] = await embedder.embed([QUERY], 'query');
    const embedded = await embedder.embed(passages, 'passage');
    for (const { dense } of [query, ...embedded]) {
      const norm = Math.sqrt(dot(dense, dense));
      if (dense.length !== DIMENSIONS || Math.abs(norm - 1) > 1e-4) {
        console.error(
          `FAIL: expected unit vectors of ${DIMENSIONS} dimensions, got ${dense.length} with length ${norm}`,
        );
        return 1;
      }
    }
    const [right, unrelated] = embedded.map(({ dense }) => dot(query.dense, dense));
    console.log(`Embedder: ${embedder.name} (${embedder.model}), ${query.dense.length} dimensions`);
    console.log(`"${QUERY}" vs ${RIGHT}: ${right.toFixed(4)}`);
    console.log(`"${QUERY}" vs ${UNRELATED}: ${unrelated.toFixed(4)}`);
    console.log(`Sparse weights: ${query.sparse ? 'yes' : 'no'}`);
    if (right > unrelated) {
      console.log(`OK: ${RIGHT} is closer.`);
      return 0;
    }
    console.error(`FAIL: ${UNRELATED} is at least as close as ${RIGHT}.`);
    return 1;
  });
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

/** The cosine similarity of two unit vectors. */
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
