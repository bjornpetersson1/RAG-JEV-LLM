import { withDatabase } from '../db/with-database.js';
import { describeError } from '../errors.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleModel } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import { TAGS_PER_CHUNK } from '../llm/roles.js';
import { parsePositiveInteger } from '../env.js';
import { loadTaggingConfig } from './config.js';
import { VOCABULARY_PATH } from './paths.js';
import { syncVocabulary } from './sync-vocabulary.js';
import { tagChunks, type TaggingSummary } from './tag-chunks.js';
import { loadVocabulary } from './vocabulary.js';

const USAGE = 'Usage: index <vocabulary | tag [--force] [--limit <n>]>';

const [command, ...flags] = process.argv.slice(2);

const consoleLogger: LlmLogger = {
  info: (entry, message) => console.log(`${message} ${JSON.stringify(entry)}`),
  error: (entry, message) => console.error(`${message} ${JSON.stringify(entry)}`),
};

try {
  process.exitCode = await run();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function run(): Promise<number> {
  if (command === 'vocabulary' && flags.length === 0) return runVocabulary();
  if (command === 'tag') {
    const tagFlags = parseTagFlags(flags);
    if (tagFlags) return runTag(tagFlags);
  }
  console.error(USAGE);
  return 1;
}

function runVocabulary(): Promise<number> {
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

interface TagFlags {
  force: boolean;
  limit?: number;
}

/** `--force` and `--limit <n>` in any order, or undefined for anything else. */
function parseTagFlags(args: string[]): TagFlags | undefined {
  const flags: TagFlags = { force: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--force' && !flags.force) {
      flags.force = true;
    } else if (args[index] === '--limit' && flags.limit === undefined) {
      flags.limit = parsePositiveInteger(args[++index] ?? '');
      if (flags.limit === undefined) return undefined;
    } else {
      return undefined;
    }
  }
  return flags;
}

async function runTag({ force, limit }: TagFlags): Promise<number> {
  const vocabulary = loadVocabulary(VOCABULARY_PATH);
  const llmConfig = loadLlmConfig(process.env);
  const { concurrency } = loadTaggingConfig(process.env);
  const model = roleModel(llmConfig, 'tagger');
  const { tagger } = createLlmRoles(llmConfig, { logger: consoleLogger });

  const summary = await withDatabase((db) =>
    tagChunks({ db, tagger, vocabulary, model, concurrency, force, limit, logger: consoleLogger }),
  );
  console.log(describeSummary(summary));
  return summary.failed > 0 ? 1 : 0;
}

function describeSummary(summary: TaggingSummary): string {
  const seconds = (Date.parse(summary.finishedAt) - Date.parse(summary.startedAt)) / 1000;
  const { usage } = summary;
  const cost = (usd: number | undefined) =>
    usd === undefined ? 'unknown' : `${usd.toFixed(4)} USD`;
  const perChunk =
    summary.costUsd === undefined || summary.tagged === 0
      ? undefined
      : summary.costUsd / summary.tagged;
  return [
    `Tagging with ${summary.model}, vocabulary ${summary.vocabularyVersion}:`,
    `  chunks: tagged ${summary.tagged}, skipped ${summary.skipped}, failed ${summary.failed}` +
      (summary.remaining > 0 ? `, left for a later run ${summary.remaining}` : ''),
    `  discarded slugs ${summary.discardedSlugs}; chunks with fewer than ${TAGS_PER_CHUNK.min} tags ${summary.belowMin}, cut to ${TAGS_PER_CHUNK.max} tags ${summary.aboveMax}`,
    `  tokens: input ${usage.inputTokens}, output ${usage.outputTokens}, cache write ${usage.cacheWriteTokens}, cache read ${usage.cacheReadTokens}`,
    `  estimated cost: ${cost(summary.costUsd)} in total, ${cost(perChunk)} per tagged chunk`,
    `  time: ${seconds.toFixed(1)} s`,
  ].join('\n');
}
