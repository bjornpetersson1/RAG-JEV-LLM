import { importDocuments, type ImportOptions, type ImportResult } from './import-documents.js';
import { parseRulingRecord } from './parse-ruling.js';
import type { RulingSection } from './structure.js';

/** Imports every ruling in the manifest, keeping only the deciding court's own part. */
export function importRulings(options: ImportOptions): ImportResult {
  return importDocuments({
    ...options,
    type: 'ruling',
    parse: (content, entry) => {
      const ruling = parseRulingRecord(content);
      if (ruling.identifier !== entry.identifier) {
        throw new Error(`The record is for ${ruling.identifier}`);
      }
      return {
        row: {
          title: ruling.title,
          court: ruling.court,
          date: ruling.date,
          rawText: ruling.text,
          structure: ruling.structure,
          consolidatedThrough: null,
        },
        summary: describeSections(ruling.structure.sections),
        warnings: ruling.warnings,
      };
    },
  });
}

function describeSections(sections: RulingSection[]): string {
  const subsections = sections.reduce((count, section) => count + section.subsections.length, 0);
  return `${sections.length} sections, ${subsections} sub-sections`;
}
