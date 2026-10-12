// `npm run query -- "<instruction>" --template <employment|nda> [--reference]` (E6-2, E5-4): the
// whole query flow, or the reference RAG, in the terminal, printing the draft, its sources and the
// time per step.

import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { createConsoleLogger } from '../llm/console-logger.js';
import { formatQueryResult } from './format.js';
import { parseQueryArgs, QUERY_USAGE } from './query-args.js';
import { runQuery } from './query-flow.js';
import { createQueryFlow } from './setup.js';
import { createReferenceFlow } from '../reference/setup.js';

// Every call and search logs at info level; the printed result already says what happened.
const problemLogger = createConsoleLogger({ quiet: true });

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(args: string[]): Promise<number> {
  const parsed = parseQueryArgs(args);
  if (!parsed) {
    console.error(QUERY_USAGE);
    return 1;
  }
  return withDatabase(async (db) => {
    const { request, limits } = parsed;
    const flow = parsed.reference
      ? createReferenceFlow(db, process.env, problemLogger, limits)
      : createQueryFlow(db, process.env, problemLogger, limits);
    const result = await runQuery(request, flow);
    console.log(formatQueryResult(request, result));
    return 0;
  });
}
