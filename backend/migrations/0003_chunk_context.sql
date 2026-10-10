-- A context line per chunk (document title and heading path) that later roles put in front of the
-- text, and the source reference as each chunk's stable key within its document.

ALTER TABLE chunks ADD COLUMN context TEXT NOT NULL DEFAULT '';

-- Re-chunking matches existing chunks on this, so ids and tags survive when the text is unchanged.
CREATE UNIQUE INDEX chunks_document_source_ref ON chunks (document_id, source_ref);
