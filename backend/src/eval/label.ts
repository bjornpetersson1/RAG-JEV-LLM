// `eval:label`: the candidate chunks for one evaluation query, so a human can mark the relevant
// ones quickly (E5-3). Since E7-10 it also lists the reference RAG's candidates (BM25 since E10-1),
// so chunks only the reference RAG finds get labelled too.

import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import { loadReferenceConfig } from '../reference/config.js';
import { createLexicalSearch } from '../reference/lexical-search.js';
import { collapseWhitespace } from '../text.js';
import type { EvalQuery } from './queries.js';
import type { SearchDependencies } from './run.js';

/** A search that lists candidates: tag search, full-text search or the reference RAG's BM25. */
export type LabelSearch = 'tags' | 'fts' | 'reference';

const SEARCHES: readonly LabelSearch[] = ['tags', 'fts', 'reference'];

export interface LabelCandidate {
  chunkId: string;
  document: string;
  sourceRef: string;
  /** Every search that found the chunk, in the order tags, fts, reference. */
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
  /** The chunk ids the reference RAG's search finds for the instruction, best first. */
  reference(instruction: string): Promise<string[]>;
}

/** The `MAX_CANDIDATES` chunks BM25 ranks best for the instruction, as the reference RAG finds them. */
export function createLabelReferenceSearch(
  db: DatabaseSync,
  env: Env,
): LabelDependencies['reference'] {
  const search = createLexicalSearch(db, loadReferenceConfig(env).candidates);
  return async (instruction) => {
    const { candidates } = await search(instruction, []);
    return candidates.map((candidate) => String(candidate.chunkId));
  };
}

/** The query's tag-search, full-text and reference candidates, in that order. */
export async function labelCandidates(
  query: EvalQuery,
  deps: LabelDependencies,
  db: DatabaseSync,
): Promise<LabelListing> {
  // The reference search needs only the instruction, so it runs while the query is translated.
  const [tags, referenceIds] = await Promise.all([
    deps.translate(query),
    deps.reference(query.instruction),
  ]);
  const found: Record<LabelSearch, Set<string>> = {
    tags: new Set(deps.search(query, tags, 'tags')),
    fts: new Set(deps.search(query, tags, 'fts')),
    reference: new Set(referenceIds),
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
  const onlyReference = candidates.filter(
    (candidate) => candidate.foundBy.length === 1 && candidate.foundBy[0] === 'reference',
  ).length;
  const foundByWidth = Math.max(
    0,
    ...candidates.map((candidate) => foundByLabel(candidate).length),
  );
  return [
    `${query.id} (${query.kind}${query.template ? `, template ${query.template}` : ''}): ${query.instruction}`,
    `Tags: ${tags.join(', ') || 'none'}`,
    `${candidates.length} candidates (tags ${count('tags')}, fts ${count('fts')}, ` +
      `reference ${count('reference')}; ${onlyReference} only reference); [x] = already marked relevant`,
    ...candidates.flatMap((candidate) => [
      '',
      `[${candidate.marked ? 'x' : ' '}] #${candidate.chunkId} ${foundByLabel(candidate).padEnd(foundByWidth)} document: ${candidate.document} | sourceRef: ${candidate.sourceRef}`,
      `    tags: ${candidate.tags.join(', ') || 'none'}`,
      `    ${collapseWhitespace(candidate.text).slice(0, textChars)}`,
    ]),
  ].join('\n');
}

/** The searches that found a candidate, e.g. `tags+reference`. */
function foundByLabel(candidate: LabelCandidate): string {
  return candidate.foundBy.join('+');
}

interface ChunkRow {
  document: string;
  sourceRef: string;
  text: string;
  tags: string | null;
}
