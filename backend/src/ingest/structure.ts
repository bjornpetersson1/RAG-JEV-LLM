/** The parsed structure of a document, stored as JSON in `documents.structure`. */

export interface LawSection {
  /** E.g. `7` or `2 a`. */
  number: string;
  /** The nearest heading above the section within its chapter, e.g. "Lagens ändamål". */
  heading: string | null;
  /** The paragraphs (stycken) without the leading section number; list items stay in the paragraph that introduces them. */
  paragraphs: string[];
  /** The SFS number of the last amendment, moved out of the text, e.g. `2014:958`. */
  amendedBy: string | null;
}

export interface LawChapter {
  /** `null` for a law without chapters, which has exactly one chapter. */
  number: string | null;
  title: string | null;
  sections: LawSection[];
}

export interface TransitionalEntry {
  /** The SFS number of the act the provisions belong to, e.g. `2008:567`. */
  sfs: string;
  paragraphs: string[];
}

export interface LawStructure {
  kind: 'law';
  chapters: LawChapter[];
  transitional: TransitionalEntry[];
}

export type DocumentStructure = LawStructure;
