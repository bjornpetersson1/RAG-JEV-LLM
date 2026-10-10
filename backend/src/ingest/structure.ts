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

export interface RulingSubsection {
  heading: string;
  paragraphs: string[];
}

/**
 * What a ruling section is: the opening lines before the first heading, the parties' cases, the
 * court's reasons, its ruling, a judge's dissent or addition, or the whole ruling when no sections
 * were recognised. `opening`, `dissent`, `addition` and `whole` sections carry a heading the
 * importer gave them ("Inledning", "Skiljaktig mening", "Tillägg", "Domen").
 */
export type RulingSectionRole =
  'opening' | 'proceedings' | 'reasons' | 'ruling' | 'dissent' | 'addition' | 'whole';

export interface RulingSection {
  /** E.g. "Bakgrund", "Domskäl", "Domslut", or a heading given by role (see `RulingSectionRole`). */
  heading: string;
  role: RulingSectionRole;
  /** Paragraphs before the first sub-section. */
  paragraphs: string[];
  subsections: RulingSubsection[];
}

export interface RulingStructure {
  kind: 'ruling';
  /** `AD` or `HD`. */
  court: string;
  /** Every reference number of the record, e.g. `NJA 2015 s. 741` and `NJA 2015:69`. */
  references: string[];
  /** E.g. `B 116-22`, `T 980-14`. */
  caseNumbers: string[];
  /** The case-law API's summary, or `null`. */
  summary: string | null;
  sections: RulingSection[];
}

export type DocumentStructure = LawStructure | RulingStructure;
