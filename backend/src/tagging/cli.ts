import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import { VOCABULARY_PATH } from './paths.js';
import { syncVocabulary } from './sync-vocabulary.js';
import { loadVocabulary } from './vocabulary.js';

const USAGE = 'Usage: index <vocabulary>';

const [command, ...flags] = process.argv.slice(2);

try {
  process.exitCode = run();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

function run(): number {
  if (command === 'vocabulary' && flags.length === 0) return runVocabulary();
  console.error(USAGE);
  return 1;
}

function runVocabulary(): number {
  // Validate before opening the database, so an invalid file changes nothing.
  const vocabulary = loadVocabulary(VOCABULARY_PATH);
  return withDatabase((db) => {
    const result = syncVocabulary(db, vocabulary.tags);
    console.log(
      `Vocabulary ${vocabulary.version}: ${vocabulary.tags.length} tags; ` +
        `inserted ${result.inserted}, updated ${result.updated}, deleted ${result.deleted}, unchanged ${result.unchanged}`,
    );
    return 0;
  });
}
