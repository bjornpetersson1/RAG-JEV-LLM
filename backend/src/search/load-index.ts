import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { countRows, openDatabase } from '../db/database.js';
import { migrationLabel, pendingMigrations } from '../db/migrations.js';
import { measure } from './measure.js';
import { EMPTY_TAG_INDEX, type BuildTagIndex, type ChunkTag, type TagIndex } from './tag-index.js';

/** The part of Fastify's logger the loader uses. */
export interface IndexLogger {
  info(entry: object, message: string): void;
  warn(entry: object, message: string): void;
}

const SET_UP = 'run `npm run db:migrate`, the data commands and `npm run index:tag`';

/**
 * Builds the tag index from `chunk_tags` in the database at `databasePath`, logging build time,
 * counts and memory. A missing or unmigrated database, or one without tags, gives an empty index and
 * a warning naming the command to run; the database is never created or migrated here.
 */
export function loadTagIndex(
  databasePath: string,
  build: BuildTagIndex,
  logger: IndexLogger,
): TagIndex {
  const read = readChunkTags(databasePath);
  if ('emptyReason' in read) {
    logger.warn({ databasePath }, `Tag index is empty: ${read.emptyReason}`);
    return EMPTY_TAG_INDEX;
  }
  const { chunkTags } = read;
  const { result: index, elapsedMs, memoryBytes } = measure(() => build(chunkTags));
  logger.info(
    {
      index: index.description,
      chunks: index.chunkCount,
      tags: index.tagCount,
      chunkTags: chunkTags.length,
      buildMs: elapsedMs,
      memoryBytes,
    },
    'Tag index built',
  );
  return index;
}

/** Every chunk–tag pair, or why the index has to be empty. */
function readChunkTags(databasePath: string): { chunkTags: ChunkTag[] } | { emptyReason: string } {
  if (!existsSync(databasePath))
    return { emptyReason: `no database at ${databasePath}; ${SET_UP}` };
  const db = openDatabase(databasePath, { readOnly: true });
  try {
    const pending = pendingMigrations(db);
    if (pending.length > 0) {
      const labels = pending.map(migrationLabel).join(', ');
      return {
        emptyReason: `the database has pending migrations (${labels}); run \`npm run db:migrate\``,
      };
    }
    const chunkTags = selectChunkTags(db);
    if (chunkTags.length > 0) return { chunkTags };
    return countRows(db, 'SELECT COUNT(*) AS n FROM chunks') > 0
      ? { emptyReason: 'no chunk has tags; run `npm run index:tag`' }
      : { emptyReason: `the database has no chunks; ${SET_UP}` };
  } finally {
    db.close();
  }
}

function selectChunkTags(db: DatabaseSync): ChunkTag[] {
  return db
    .prepare(
      'SELECT ct.chunk_id AS chunkId, t.slug AS slug FROM chunk_tags ct JOIN tags t ON t.id = ct.tag_id',
    )
    .all() as unknown as ChunkTag[];
}
