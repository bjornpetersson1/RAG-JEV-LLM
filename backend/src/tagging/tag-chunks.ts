import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { inTransaction } from '../db/database.js';
import { describeError } from '../errors.js';
import { LlmError, sumUsage, type LlmLogger, type LlmUsage } from '../llm/client.js';
import { estimateCostUsd } from '../llm/pricing.js';
import { TAGS_PER_CHUNK } from '../llm/roles.js';
import type { Tagger, TaggingResult } from '../llm/types.js';
import { syncVocabulary } from './sync-vocabulary.js';
import type { Vocabulary } from './vocabulary.js';

export interface TagChunksOptions {
  db: DatabaseSync;
  tagger: Tagger;
  vocabulary: Vocabulary;
  /** The tagger's model, stored per chunk; `fake` for the fake provider. */
  model: string;
  concurrency: number;
  /** Re-tag chunks that are already tagged with the current model and vocabulary. */
  force?: boolean;
  /** Tag at most this many chunks. */
  limit?: number;
  logger: LlmLogger;
}

export interface TaggingSummary {
  startedAt: string;
  finishedAt: string;
  model: string;
  vocabularyVersion: string;
  tagged: number;
  /** Chunks already tagged with the current model and vocabulary. */
  skipped: number;
  failed: number;
  /** Chunks left untagged because of `limit`. */
  remaining: number;
  discardedSlugs: number;
  belowMin: number;
  aboveMax: number;
  usage: LlmUsage;
  /** Undefined when the model is not in the price table. */
  costUsd: number | undefined;
}

/**
 * Chunks to tag: every chunk with `:force`, otherwise those not tagged with this model and
 * vocabulary. They are taken untagged first, then oldest tagged first, so repeated
 * `--force --limit` runs work through the corpus instead of re-tagging the same chunks.
 */
const PENDING = ':force OR tagged_model IS NOT :model OR tagged_vocabulary_version IS NOT :version';

interface PendingChunk {
  id: number;
  source_ref: string;
  context: string;
  text: string;
}

/**
 * Syncs the vocabulary, then tags every chunk that is not tagged with the current model and
 * vocabulary version, `concurrency` at a time. Each chunk's tags and tagging state are committed as
 * soon as it is tagged, so an interrupted run resumes where it stopped. A chunk whose tagging fails
 * is logged and left untagged. The run's summary is stored in `tagging_runs`.
 */
export async function tagChunks(options: TagChunksOptions): Promise<TaggingSummary> {
  const { db, tagger, vocabulary, model, logger } = options;
  const startedAt = new Date().toISOString();
  syncVocabulary(db, vocabulary.tags);

  const pendingParams = { force: options.force ? 1 : 0, model, version: vocabulary.version };
  const total = count(db, 'SELECT COUNT(*) AS n FROM chunks', {});
  const pendingCount = count(
    db,
    `SELECT COUNT(*) AS n FROM chunks WHERE ${PENDING}`,
    pendingParams,
  );
  const queue = db
    .prepare(
      `SELECT id, source_ref, context, text FROM chunks WHERE ${PENDING}
       ORDER BY tagged_at IS NOT NULL, tagged_at, document_id, ordinal LIMIT :limit`,
    )
    .all({ ...pendingParams, limit: options.limit ?? pendingCount }) as unknown as PendingChunk[];
  const store = createTagStore(db, model, vocabulary.version);

  const results: TaggingResult[] = [];
  let failed = 0;
  // Tokens billed for chunks whose tagging failed after a call went through.
  const failedUsages: LlmUsage[] = [];
  async function tagOne(chunk: PendingChunk): Promise<void> {
    const where = { chunkId: chunk.id, sourceRef: chunk.source_ref };
    try {
      const result = await tagger.tag(
        { text: chunk.text, context: chunk.context, source: chunk.source_ref },
        vocabulary.tags,
      );
      store(chunk.id, result.tags);
      results.push(result);
      logger.info(
        {
          ...where,
          tags: result.tags,
          discarded: result.discarded,
          overLimit: result.overLimit,
          retried: result.retried,
          belowMin: isBelowMin(result),
          ...result.usage,
          costUsd: estimateCostUsd(model, result.usage),
        },
        'Tagged chunk',
      );
    } catch (error) {
      failed += 1;
      if (error instanceof LlmError && error.usage) failedUsages.push(error.usage);
      logger.error({ ...where, error: describeError(error) }, 'Tagging chunk failed');
    }
  }

  // The first chunk alone writes the cached prompt, so the parallel calls after it read the cache
  // instead of each paying for a cache write.
  let next = 0;
  if (queue.length > 0) await tagOne(queue[next++]);
  const worker = async () => {
    while (next < queue.length) await tagOne(queue[next++]);
  };
  const workers = Math.min(options.concurrency, queue.length - next);
  await Promise.all(Array.from({ length: workers }, worker));

  const usage = sumUsage([...results.map((result) => result.usage), ...failedUsages]);
  const summary: TaggingSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    vocabularyVersion: vocabulary.version,
    tagged: results.length,
    skipped: total - pendingCount,
    failed,
    remaining: pendingCount - queue.length,
    discardedSlugs: results.reduce((sum, result) => sum + result.discarded.length, 0),
    belowMin: results.filter(isBelowMin).length,
    aboveMax: results.filter((result) => result.overLimit.length > 0).length,
    usage,
    costUsd: estimateCostUsd(model, usage),
  };
  storeRun(db, summary);
  return summary;
}

function isBelowMin(result: TaggingResult): boolean {
  return result.tags.length < TAGS_PER_CHUNK.min;
}

function count(db: DatabaseSync, sql: string, params: Record<string, SQLInputValue>): number {
  return (db.prepare(sql).get(params) as { n: number }).n;
}

/** Replaces a chunk's tags and records its tagging state, in one transaction. */
function createTagStore(db: DatabaseSync, model: string, vocabularyVersion: string) {
  const tagIds = new Map(
    (db.prepare('SELECT id, slug FROM tags').all() as { id: number; slug: string }[]).map((tag) => [
      tag.slug,
      tag.id,
    ]),
  );
  const deleteTags = db.prepare('DELETE FROM chunk_tags WHERE chunk_id = ?');
  const insertTag = db.prepare(
    `INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const markTagged = db.prepare(
    'UPDATE chunks SET tagged_model = ?, tagged_vocabulary_version = ?, tagged_at = ? WHERE id = ?',
  );

  return (chunkId: number, slugs: string[]) => {
    // Another tagger than the LLM one might repeat a slug; the primary key allows it once.
    const tagIdsOfChunk = [...new Set(slugs)].map((slug) => {
      const id = tagIds.get(slug);
      if (id === undefined) throw new Error(`The tagger returned an unknown tag "${slug}"`);
      return id;
    });
    const taggedAt = new Date().toISOString();
    inTransaction(db, () => {
      deleteTags.run(chunkId);
      for (const tagId of tagIdsOfChunk) {
        insertTag.run(chunkId, tagId, model, vocabularyVersion, taggedAt);
      }
      markTagged.run(model, vocabularyVersion, taggedAt, chunkId);
    });
  };
}

function storeRun(db: DatabaseSync, summary: TaggingSummary): void {
  db.prepare(
    `INSERT INTO tagging_runs (
       started_at, finished_at, model, vocabulary_version, chunks_tagged, chunks_skipped,
       chunks_failed, discarded_slugs, chunks_below_min, chunks_above_max, input_tokens,
       output_tokens, cache_write_tokens, cache_read_tokens, cost_usd
     ) VALUES (
       :startedAt, :finishedAt, :model, :vocabularyVersion, :tagged, :skipped,
       :failed, :discardedSlugs, :belowMin, :aboveMax, :inputTokens,
       :outputTokens, :cacheWriteTokens, :cacheReadTokens, :costUsd
     )`,
  ).run({
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    model: summary.model,
    vocabularyVersion: summary.vocabularyVersion,
    tagged: summary.tagged,
    skipped: summary.skipped,
    failed: summary.failed,
    discardedSlugs: summary.discardedSlugs,
    belowMin: summary.belowMin,
    aboveMax: summary.aboveMax,
    ...summary.usage,
    costUsd: summary.costUsd ?? null,
  });
}
