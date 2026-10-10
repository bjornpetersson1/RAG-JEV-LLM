import { readFileSync } from 'node:fs';

export interface LawSelection {
  type: 'law';
  /** `SFS <number>`, the key the importer stores. */
  identifier: string;
  title: string;
  sfsNumber: string;
}

export interface RulingSelection {
  type: 'ruling';
  /** The reference number, e.g. `AD 2024 nr 13` or `NJA 2015 s. 741`. */
  identifier: string;
  title: string;
  /** The publication id in Domstolsverket's case-law API. */
  publicationId: string;
}

export type SelectedDocument = LawSelection | RulingSelection;

/** Reads and checks the committed selection file. */
export function loadSelection(path: string): SelectedDocument[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { documents?: unknown };
  if (!Array.isArray(parsed.documents)) {
    throw new Error(`Invalid selection ${path}: expected a "documents" array`);
  }
  const seen = new Set<string>();
  return parsed.documents.map((document: unknown, index) => {
    const checked = checkDocument(document, `${path} documents[${index}]`);
    if (seen.has(checked.identifier)) {
      throw new Error(`Invalid selection ${path}: duplicate identifier ${checked.identifier}`);
    }
    seen.add(checked.identifier);
    return checked;
  });
}

function checkDocument(value: unknown, where: string): SelectedDocument {
  const document = value as Record<string, unknown>;
  const text = (key: string): string => {
    const field = document?.[key];
    if (typeof field !== 'string' || field.trim() === '') {
      throw new Error(`Invalid selection ${where}: "${key}" must be a non-empty string`);
    }
    return field;
  };
  const common = { identifier: text('identifier'), title: text('title') };
  switch (document?.type) {
    case 'law':
      return { type: 'law', ...common, sfsNumber: text('sfsNumber') };
    case 'ruling':
      return { type: 'ruling', ...common, publicationId: text('publicationId') };
    default:
      throw new Error(`Invalid selection ${where}: "type" must be "law" or "ruling"`);
  }
}
