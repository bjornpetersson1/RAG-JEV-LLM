// The evaluation set (E5-3): queries with the chunks a human marked as relevant, in
// `eval/queries.yaml`. Chunks are referenced by document identifier and source reference, which
// survive a re-import, unlike chunk ids.

import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { parse } from 'yaml';
import { isTemplate, type Template } from '../tagging/vocabulary.js';

export interface ChunkRef {
  /** The document identifier, e.g. `SFS 1982:80` or `AD 2001 nr 91`. */
  document: string;
  /** The chunk's stored source reference, e.g. `SFS 1982:80 4 b §`. */
  sourceRef: string;
}

export interface EvalQuery {
  id: string;
  /** Which contract the query is for. */
  kind: Template;
  instruction: string;
  /** A chosen template adds its preset tags, as in the query flow. */
  template?: Template;
  relevant: ChunkRef[];
}

/** A query with its relevant chunks resolved to chunk ids in the database. */
export interface ResolvedQuery extends EvalQuery {
  relevantIds: ReadonlySet<string>;
}

/** What a complete evaluation set must contain. */
const EVAL_SET_RULES = { queries: 20, perKind: 8, withTemplate: 4 } as const;

export function readEvalQueries(path: string): EvalQuery[] {
  return parseEvalQueries(readFileSync(path, 'utf8'));
}

/** The queries in the YAML `text`; throws one error listing every malformed query. */
export function parseEvalQueries(text: string): EvalQuery[] {
  const document = parse(text) as { queries?: unknown } | null;
  if (!Array.isArray(document?.queries))
    throw new Error('The evaluation set needs a "queries" list');
  const problems: string[] = [];
  const queries = document.queries.flatMap((entry: unknown, index) => {
    const query = parseQuery(entry);
    if (typeof query === 'string') {
      problems.push(`${queryName(entry, index)}: ${query}`);
      return [];
    }
    return [query];
  });
  const seen = new Set<string>();
  for (const { id } of queries) {
    if (seen.has(id)) problems.push(`query ${id}: the id is used twice`);
    seen.add(id);
  }
  if (problems.length > 0) throw evalSetError(problems);
  return queries;
}

/**
 * Checks the set against {@link EVAL_SET_RULES} and resolves every relevant chunk in `db`; throws
 * one error listing every problem, each naming its query.
 */
export function resolveEvalQueries(
  queries: readonly EvalQuery[],
  db: DatabaseSync,
): ResolvedQuery[] {
  const rules = EVAL_SET_RULES;
  const problems: string[] = [];
  const count = (kind: Template) => queries.filter((query) => query.kind === kind).length;
  if (queries.length !== rules.queries) {
    problems.push(`expected ${rules.queries} queries, found ${queries.length}`);
  }
  for (const kind of ['employment', 'nda'] as const) {
    if (count(kind) < rules.perKind) {
      problems.push(`expected at least ${rules.perKind} ${kind} queries, found ${count(kind)}`);
    }
  }
  const withTemplate = queries.filter((query) => query.template !== undefined).length;
  if (withTemplate < rules.withTemplate) {
    problems.push(
      `expected at least ${rules.withTemplate} queries with a template, found ${withTemplate}`,
    );
  }

  const findChunk = db.prepare(
    `SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.identifier = ? AND c.source_ref = ?`,
  );
  const resolved = queries.map((query) => {
    if (query.relevant.length === 0)
      problems.push(`query ${query.id}: no relevant chunk is marked`);
    const relevantIds = new Set<string>();
    for (const ref of query.relevant) {
      const row = findChunk.get(ref.document, ref.sourceRef) as { id: number } | undefined;
      if (row) relevantIds.add(String(row.id));
      else problems.push(`query ${query.id}: no chunk "${ref.sourceRef}" in ${ref.document}`);
    }
    return { ...query, relevantIds };
  });
  if (problems.length > 0) throw evalSetError(problems);
  return resolved;
}

/** The query, or what is wrong with it. */
function parseQuery(entry: unknown): EvalQuery | string {
  if (typeof entry !== 'object' || entry === null) return 'expected a mapping';
  const { id, kind, instruction, template, relevant } = entry as Record<string, unknown>;
  if (typeof id !== 'string' || id.trim() === '') return 'missing "id"';
  if (typeof kind !== 'string' || !isTemplate(kind)) return '"kind" must be employment or nda';
  if (typeof instruction !== 'string' || instruction.trim() === '') return 'missing "instruction"';
  if (template !== undefined && template !== kind) {
    return `"template" must be the query's kind (${kind}) when given`;
  }
  if (!Array.isArray(relevant)) return '"relevant" must be a list';
  const refs: ChunkRef[] = [];
  for (const ref of relevant as unknown[]) {
    const { document, sourceRef } = (ref ?? {}) as Record<string, unknown>;
    if (typeof document !== 'string' || typeof sourceRef !== 'string') {
      return 'every relevant chunk needs "document" and "sourceRef"';
    }
    refs.push({ document, sourceRef });
  }
  return {
    id,
    kind,
    instruction,
    ...(template === undefined ? {} : { template: kind }),
    relevant: refs,
  };
}

function queryName(entry: unknown, index: number): string {
  const id = (entry as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id !== '' ? `query ${id}` : `query #${index + 1}`;
}

function evalSetError(problems: string[]): Error {
  return new Error(
    `Invalid evaluation set:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
  );
}
