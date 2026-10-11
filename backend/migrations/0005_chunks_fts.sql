-- Full-text index over the chunks (E4-3), the fallback when tag search finds too few candidates.
-- External content: the text lives only in `chunks`, and the triggers keep the index in step.
-- unicode61 folds case but keeps å, ä and ö apart from a and o (remove_diacritics 0).

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  context,
  source_ref,
  content = 'chunks',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 0'
);

CREATE TRIGGER chunks_fts_after_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, text, context, source_ref)
  VALUES (new.id, new.text, new.context, new.source_ref);
END;

CREATE TRIGGER chunks_fts_after_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text, context, source_ref)
  VALUES ('delete', old.id, old.text, old.context, old.source_ref);
END;

-- Only when an indexed value changes: tagging state and ordinals change without reindexing, and so
-- does a re-chunk that rewrites a chunk with the same content.
CREATE TRIGGER chunks_fts_after_update AFTER UPDATE OF text, context, source_ref ON chunks
WHEN old.text IS NOT new.text OR old.context IS NOT new.context OR old.source_ref IS NOT new.source_ref
BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text, context, source_ref)
  VALUES ('delete', old.id, old.text, old.context, old.source_ref);
  INSERT INTO chunks_fts (rowid, text, context, source_ref)
  VALUES (new.id, new.text, new.context, new.source_ref);
END;

-- Index the chunks that already exist.
INSERT INTO chunks_fts (chunks_fts) VALUES ('rebuild');
