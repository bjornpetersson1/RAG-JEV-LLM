// `eval:label`: the candidate chunks for one evaluation query, so a human can mark the relevant
// ones quickly (E5-3). Since E7-10 it also lists the reference RAG's dense candidates, so chunks
// only vector search finds get labelled too.

import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import { createDenseSearch } from '../reference/dense-search.js';
import { loadRetrievalResources, type RetrievalSource } from '../retrieval/setup.js';
import { loadSearchConfig } from '../search/config.js';
import { collapseWhitespace } from '../text.js';
import type { EvalQuery } from './queries.js';
import type { SearchDependencies } from './run.js';

/** A search that lists candidates: tag search, full-text search or the reference's vectors. */
export type LabelSearch = 'tags' | 'fts' | 'dense';

const SEARCHES: readonly LabelSearch[] = ['tags', 'fts', 'dense'];

export interface LabelCandidate {
  chunkId: string;
  document: string;
  sourceRef: string;
  /** Every search that found the chunk, in the order tags, fts, dense. */
  foundBy: LabelSearch[];
  tags: string[];
  text: string;
  /** Whether the query already marks the chunk as relevant. */
  marked: boolean;
}

export interface LabelListing {
  tags: string[];
  candidates: LabelCandidate[];
}

export interface LabelDependencies extends Pick<SearchDependencies, 'translate' | 'search'> {
  /** The chunk ids the reference RAG's vector search finds for the instruction, nearest first. */
  dense(instruction: string): Promise<string[]>;
}

/**
 * The `MAX_CANDIDATES` chunks nearest the instruction, as the reference RAG finds them. Fails,
 * naming `npm run index:embed`, when the chunks are not embedded with the embedder.
 */
export function createLabelDenseSearch(
  db: DatabaseSync,
  env: Env,
  /** By default `EMBEDDER` and its stored vectors; a fake embedder in tests. */
  source?: RetrievalSource,
): LabelDependencies['dense'] {
  const { embedder, vectorIndex } = loadRetrievalResources(db, env, source);
  const search = createDenseSearch(embedder, vectorIndex, loadSearchConfig(env).maxCandidates);
  return async (instruction) => {
    const { candidates } = await search(instruction, []);
    return candidates.map((candidate) => String(candidate.chunkId));
  };
}

/** The query's tag-search, full-text and dense candidates: tag hits first, then fts, then dense. */
export async function labelCandidates(
  query: EvalQuery,
  deps: LabelDependencies,
  db: DatabaseSync,
): Promise<LabelListing> {
  // The dense search needs only the instruction, so it runs while the query is translated.
  const [tags, denseIds] = await Promise.all([
    deps.translate(query),
    deps.dense(query.instruction),
  ]);
  const found: Record<LabelSearch, Set<string>> = {
    tags: new Set(deps.search(query, tags, 'tags')),
    fts: new Set(deps.search(query, tags, 'fts')),
    dense: new Set(denseIds),
  };
  const ids = [...new Set(SEARCHES.flatMap((search) => [...found[search]]))];
  const describe = db.prepare(
    `SELECT d.identifier AS document, c.source_ref AS sourceRef, c.text AS text,
       (SELECT group_concat(t.slug, ',') FROM chunk_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.chunk_id = c.id) AS tags
     FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ?`,
  );
  const marked = new Set(query.relevant.map((ref) => `${ref.document}\n${ref.sourceRef}`));
  const candidates = ids.map((id) => {
    const row = describe.get(Number(id)) as unknown as ChunkRow;
    return {
      chunkId: id,
      document: row.document,
      sourceRef: row.sourceRef,
      foundBy: SEARCHES.filter((search) => found[search].has(id)),
      tags: row.tags ? row.tags.split(',') : [],
      text: row.text,
      marked: marked.has(`${row.document}\n${row.sourceRef}`),
    };
  });
  return { tags, candidates };
}

/** The candidates as text: one block per chunk with the start of its text. */
export function formatCandidates(
  query: EvalQuery,
  { tags, candidates }: LabelListing,
  textChars: number,
): string {
  const count = (search: LabelSearch) =>
    candidates.filter((candidate) => candidate.foundBy.includes(search)).length;
  const onlyDense = candidates.filter(
    (candidate) => candidate.foundBy.length === 1 && candidate.foundBy[0] === 'dense',
  ).length;
  const foundByWidth = Math.max(
    0,
    ...candidates.map((candidate) => foundByLabel(candidate).length),
  );
  return [
    `${query.id} (${query.kind}${query.template ? `, template ${query.template}` : ''}): ${query.instruction}`,
    `Tags: ${tags.join(', ') || 'none'}`,
    `${candidates.length} candidates (tags ${count('tags')}, fts ${count('fts')}, dense ${count('dense')}; ` +
      `${onlyDense} only dense); [x] = already marked relevant`,
    ...candidates.flatMap((candidate) => [
      '',
      `[${candidate.marked ? 'x' : ' '}] #${candidate.chunkId} ${foundByLabel(candidate).padEnd(foundByWidth)} document: ${candidate.document} | sourceRef: ${candidate.sourceRef}`,
      `    tags: ${candidate.tags.join(', ') || 'none'}`,
      `    ${collapseWhitespace(candidate.text).slice(0, textChars)}`,
    ]),
  ].join('\n');
}

/** The searches that found a candidate, e.g. `tags+dense`. */
function foundByLabel(candidate: LabelCandidate): string {
  return candidate.foundBy.join('+');
}

interface ChunkRow {
  document: string;
  sourceRef: string;
  text: string;
  tags: string | null;
}
