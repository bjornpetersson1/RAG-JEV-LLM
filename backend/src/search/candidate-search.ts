import type { DatabaseSync } from 'node:sqlite';
import { preparedOnce } from '../db/database.js';
import type { SearchConfig } from './config.js';
import { buildFtsQuery } from './fts-query.js';
import type { IndexLogger } from './load-index.js';
import type { TagIndex } from './tag-index.js';

/**
 * How candidates are found: tag search with full-text search filling up (`tags+fts`, the query
 * flow's default), or either alone (`fts`, `tags`) as baselines for the evaluation (E5-3).
 */
export type CandidateMode = 'tags+fts' | 'fts' | 'tags';

export interface Candidate {
  chunkId: number;
  /**
   * Which search found the chunk: tag search or its full-text fallback (a chunk both find counts as
   * `tag`), or the reference RAG's BM25 search (`lexical`).
   */
  origin: 'tag' | 'fts' | 'lexical';
}

export interface CandidateSearchInput {
  instruction: string;
  /** Vocabulary slugs, from the query translator (E4-4). */
  tags: readonly string[];
  mode?: CandidateMode;
}

export interface CandidateSearchResult {
  /** Tag candidates in ranked order, then full-text candidates in bm25 order. */
  candidates: Candidate[];
  tagCandidates: number;
  /** Whether full-text search ran: too few tag candidates (or mode `fts`) and a usable query. */
  fallbackUsed: boolean;
  ftsAdded: number;
  /** The full-text query, or null when none ran (no fallback, or no usable words). */
  ftsQuery: string | null;
}

export interface CandidateSearch {
  search(input: CandidateSearchInput): CandidateSearchResult;
}

interface CandidateSearchDeps {
  db: DatabaseSync;
  tagIndex: TagIndex;
  config: Pick<SearchConfig, 'minTagCandidates' | 'maxCandidates'>;
  logger: Pick<IndexLogger, 'info'>;
}

/**
 * Finds candidate chunks for an instruction: the E4-1 tag index's ranked hits, filled up with
 * full-text hits (SQLite FTS5) when there are fewer than `minTagCandidates`, up to `maxCandidates`.
 * Every search logs one line saying whether the fallback ran and how many candidates it added.
 */
export function createCandidateSearch({
  db,
  tagIndex,
  config,
  logger,
}: CandidateSearchDeps): CandidateSearch {
  const { minTagCandidates, maxCandidates } = config;
  const statements = {
    labels: db.prepare('SELECT label FROM tags WHERE slug IN (SELECT value FROM json_each(?))'),
  };

  function ftsQueryFor(instruction: string, tags: readonly string[]): string | null {
    const rows = statements.labels.all(JSON.stringify(tags)) as { label: string }[];
    return buildFtsQuery(
      instruction,
      rows.map((row) => row.label),
    );
  }

  return {
    search({ instruction, tags, mode = 'tags+fts' }) {
      const tagHits = mode === 'fts' ? [] : tagIndex.searchRanked(tags, { limit: maxCandidates });
      const candidates: Candidate[] = tagHits.map(({ chunkId }) => ({ chunkId, origin: 'tag' }));
      const needsFullText =
        mode === 'fts' || (mode === 'tags+fts' && candidates.length < minTagCandidates);
      const ftsQuery = needsFullText ? ftsQueryFor(instruction, tags) : null;
      if (ftsQuery !== null) {
        const found = new Set(candidates.map((candidate) => candidate.chunkId));
        // `maxCandidates` rows always fill the free places, even when every tag hit is among them.
        for (const chunkId of bm25Ranking(db, ftsQuery, maxCandidates)) {
          if (candidates.length >= maxCandidates) break;
          if (!found.has(chunkId)) candidates.push({ chunkId, origin: 'fts' });
        }
      }
      const summary = {
        tagCandidates: tagHits.length,
        fallbackUsed: ftsQuery !== null,
        ftsAdded: candidates.length - tagHits.length,
        ftsQuery,
      };
      logger.info({ mode, ...summary }, 'Candidate search');
      return { candidates, ...summary };
    },
  };
}

/**
 * The `limit` chunk ids FTS5 ranks best (BM25) for `ftsQuery`, best first: the full-text fallback's
 * ranking, and the reference RAG's (E10-1).
 */
export function bm25Ranking(db: DatabaseSync, ftsQuery: string, limit: number): number[] {
  const rows = ftsRanking(db).all(ftsQuery, limit) as { chunkId: number }[];
  return rows.map(({ chunkId }) => chunkId);
}

const ftsRanking = preparedOnce((db) =>
  db.prepare(
    'SELECT rowid AS chunkId FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?',
  ),
);
