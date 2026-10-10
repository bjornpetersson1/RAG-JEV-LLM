-- The parsed structure of each document, and the last amendment a consolidated law text includes.

-- JSON tree the chunker reads: chapters, sections and paragraphs for laws, sections for rulings.
ALTER TABLE documents ADD COLUMN structure TEXT;

-- Laws only: the SFS number after "Ändring införd: t.o.m. SFS", e.g. '2022:836'.
ALTER TABLE documents ADD COLUMN consolidated_through TEXT;
