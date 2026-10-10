import { importDocuments, type ImportOptions, type ImportResult } from './import-documents.js';
import { parseLawPage, type ParsedLaw } from './parse-law.js';

/**
 * Imports every law in the manifest. `today` (ISO date) decides which version of a section with a
 * pending change is in force.
 */
export function importLaws(options: ImportOptions & { today: string }): ImportResult {
  return importDocuments({
    ...options,
    type: 'law',
    parse: (content, entry) => {
      const law = parseLawPage(content, options.today);
      if (`SFS ${law.sfsNumber}` !== entry.identifier) {
        throw new Error(`The page is for SFS ${law.sfsNumber}`);
      }
      return {
        row: {
          title: law.title,
          court: null,
          date: law.issuedOn,
          rawText: law.text,
          structure: law.structure,
          consolidatedThrough: law.consolidatedThrough,
        },
        summary: describeLaw(law),
      };
    },
  });
}

function describeLaw(law: ParsedLaw): string {
  const { chapters, transitional } = law.structure;
  const sections = chapters.reduce((count, chapter) => count + chapter.sections.length, 0);
  const chapterCount = chapters.filter((chapter) => chapter.number !== null).length;
  const leftOut = [
    law.repealed.length > 0 ? `${law.repealed.length} repealed` : '',
    law.notInForce.length > 0 ? `${law.notInForce.length} not in force` : '',
  ].filter(Boolean);
  return (
    `${chapterCount} chapters, ${sections} sections, ${transitional.length} transitional entries` +
    (leftOut.length > 0 ? ` (left out: ${leftOut.join(', ')})` : '')
  );
}
