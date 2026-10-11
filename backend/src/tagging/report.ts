import type { DatabaseSync } from 'node:sqlite';
import { TAGS_PER_CHUNK } from '../llm/roles.js';
import type { ReportConfig } from './config.js';
import { countRows } from '../db/database.js';
import { currentlyTagged } from './tag-chunks.js';

export interface ReportOptions extends ReportConfig {
  /** The vocabulary file's version; chunks tagged with another count as out of date. */
  vocabularyVersion: string;
}

export interface TagCount {
  slug: string;
  label: string;
  area: string;
  chunks: number;
  /** Share of the tagged chunks that have at least one tag. */
  share: number;
  broad: boolean;
}

export interface ChunkReference {
  id: number;
  sourceRef: string;
}

export interface ReportSummary {
  totalChunks: number;
  /** Tagged with the report's model and vocabulary version. */
  taggedChunks: number;
  /** Not tagged yet, or tagged with another model or vocabulary version. */
  outdatedChunks: number;
  chunksWithTags: number;
  chunksBelowMin: number;
  /** Over the chunks with at least one tag; 0 when there are none. */
  averageTags: number;
  tagsWithoutChunks: number;
  broadTags: number;
}

export interface LatestRun {
  finishedAt: string;
  /** Chunks the run tagged; its discarded slugs and cost cover only these. */
  chunksTagged: number;
  model: string;
  vocabularyVersion: string;
  discardedSlugs: number;
  costUsd: number | null;
}

export interface TaggingReport {
  /** The latest tagging run's model, whose chunks the report counts; undefined before any run. */
  model: string | undefined;
  vocabularyVersion: string;
  broadShare: number;
  /** Every tag, by number of chunks (most first), then slug. */
  tags: TagCount[];
  /** Tagged chunks that got zero tags, in document order. */
  chunksWithoutTags: ChunkReference[];
  summary: ReportSummary;
  /** Undefined before the first tagging run. */
  latestRun?: LatestRun;
}

/**
 * The latest tagging run that tagged chunks, or undefined before the first. A re-run that only
 * skipped chunks would otherwise replace the real run's discarded slugs and cost with zeros.
 */
function latestRun(db: DatabaseSync): LatestRun | undefined {
  return db
    .prepare(
      `SELECT finished_at AS finishedAt, chunks_tagged AS chunksTagged, model,
         vocabulary_version AS vocabularyVersion, discarded_slugs AS discardedSlugs,
         cost_usd AS costUsd
       FROM tagging_runs WHERE chunks_tagged > 0 ORDER BY id DESC LIMIT 1`,
    )
    .get() as LatestRun | undefined;
}

/**
 * Builds the control report on the tagging from the database. Only chunks tagged with the latest
 * run's model and the current vocabulary count, so tags left from an older model or vocabulary do
 * not mix with the current ones.
 */
export function buildReport(db: DatabaseSync, options: ReportOptions): TaggingReport {
  const run = latestRun(db);
  // Before any run there is no model, and no chunk is tagged with model NULL and a version.
  const params = { model: run?.model ?? null, version: options.vocabularyVersion };
  const tagsPerChunk = db
    .prepare(
      `SELECT c.id, c.source_ref, COUNT(ct.tag_id) AS tags
       FROM chunks c LEFT JOIN chunk_tags ct ON ct.chunk_id = c.id
       WHERE ${currentlyTagged('c')} GROUP BY c.id ORDER BY c.document_id, c.ordinal`,
    )
    .all(params) as { id: number; source_ref: string; tags: number }[];
  const withTags = tagsPerChunk.filter((chunk) => chunk.tags > 0);

  const tagRows = db
    .prepare(
      `SELECT t.slug, t.label, t.area, COUNT(c.id) AS chunks
       FROM tags t
       LEFT JOIN chunk_tags ct ON ct.tag_id = t.id
       LEFT JOIN chunks c ON c.id = ct.chunk_id AND ${currentlyTagged('c')}
       GROUP BY t.id ORDER BY chunks DESC, t.slug`,
    )
    .all(params) as { slug: string; label: string; area: string; chunks: number }[];
  const tags = tagRows.map((tag) => {
    const share = withTags.length === 0 ? 0 : tag.chunks / withTags.length;
    return { ...tag, share, broad: share > options.broadShare };
  });

  const totalChunks = countRows(db, 'SELECT COUNT(*) AS n FROM chunks');
  const tagLinks = withTags.reduce((sum, chunk) => sum + chunk.tags, 0);
  return {
    model: run?.model,
    vocabularyVersion: options.vocabularyVersion,
    broadShare: options.broadShare,
    tags,
    chunksWithoutTags: tagsPerChunk
      .filter((chunk) => chunk.tags === 0)
      .map((chunk) => ({ id: chunk.id, sourceRef: chunk.source_ref })),
    summary: {
      totalChunks,
      taggedChunks: tagsPerChunk.length,
      outdatedChunks: totalChunks - tagsPerChunk.length,
      chunksWithTags: withTags.length,
      chunksBelowMin: tagsPerChunk.filter((chunk) => chunk.tags < TAGS_PER_CHUNK.min).length,
      averageTags: withTags.length === 0 ? 0 : tagLinks / withTags.length,
      tagsWithoutChunks: tags.filter((tag) => tag.chunks === 0).length,
      broadTags: tags.filter((tag) => tag.broad).length,
    },
    latestRun: run,
  };
}
