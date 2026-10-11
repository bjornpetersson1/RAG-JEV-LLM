// `eval:label`: the candidate chunks for one evaluation query, so a human can mark the relevant
// ones quickly (E5-3).

import type { DatabaseSync } from 'node:sqlite';
import { collapseWhitespace } from '../text.js';
import type { EvalQuery } from './queries.js';
import type { SearchDependencies } from './run.js';

export interface LabelCandidate {
  chunkId: string;
  document: string;
  sourceRef: string;
  /** Which search found the chunk; both counts as `tags`. */
  foundBy: 'tags' | 'fts';
  tags: string[];
  text: string;
  /** Whether the query already marks the chunk as relevant. */
  marked: boolean;
}

/** The query's tag-search and full-text candidates, tag hits first. */
export async function labelCandidates(
  query: EvalQuery,
  deps: Pick<SearchDependencies, 'translate' | 'search'>,
  db: DatabaseSync,
): Promise<{ tags: string[]; candidates: LabelCandidate[] }> {
  const tags = await deps.translate(query);
  const tagIds = deps.search(query, tags, 'tags');
  const ftsIds = deps.search(query, tags, 'fts').filter((id) => !tagIds.includes(id));
  const describe = db.prepare(
    `SELECT d.identifier AS document, c.source_ref AS sourceRef, c.text AS text,
       (SELECT group_concat(t.slug, ',') FROM chunk_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.chunk_id = c.id) AS tags
     FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ?`,
  );
  const marked = new Set(query.relevant.map((ref) => `${ref.document}\n${ref.sourceRef}`));
  const candidates = [
    ...tagIds.map((id) => ({ id, foundBy: 'tags' as const })),
    ...ftsIds.map((id) => ({ id, foundBy: 'fts' as const })),
  ].map(({ id, foundBy }) => {
    const row = describe.get(Number(id)) as unknown as ChunkRow;
    return {
      chunkId: id,
      document: row.document,
      sourceRef: row.sourceRef,
      foundBy,
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
  { tags, candidates }: { tags: string[]; candidates: LabelCandidate[] },
  textChars: number,
): string {
  return [
    `${query.id} (${query.kind}${query.template ? `, template ${query.template}` : ''}): ${query.instruction}`,
    `Tags: ${tags.join(', ') || 'none'}`,
    `${candidates.length} candidates; [x] = already marked relevant`,
    ...candidates.flatMap((candidate) => [
      '',
      `[${candidate.marked ? 'x' : ' '}] #${candidate.chunkId} ${candidate.foundBy.padEnd(4)} document: ${candidate.document} | sourceRef: ${candidate.sourceRef}`,
      `    tags: ${candidate.tags.join(', ') || 'none'}`,
      `    ${collapseWhitespace(candidate.text).slice(0, textChars)}`,
    ]),
  ].join('\n');
}

interface ChunkRow {
  document: string;
  sourceRef: string;
  text: string;
  tags: string | null;
}
