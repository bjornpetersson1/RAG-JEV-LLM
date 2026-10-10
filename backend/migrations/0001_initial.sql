-- Documents (laws and rulings), their chunks, the tag vocabulary and the chunk–tag links.
-- Dates are ISO 8601 text.

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('law', 'ruling')),
  title TEXT NOT NULL,
  -- Unique key for re-imports: the SFS number for laws (e.g. 'SFS 1982:80'), and for rulings the
  -- reference number (e.g. 'AD 2019 nr 35', 'NJA 2015 s. 741'), which is unique across courts.
  identifier TEXT NOT NULL UNIQUE,
  -- Only for rulings.
  court TEXT,
  date TEXT,
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  raw_text TEXT NOT NULL
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- Position of the chunk within its document, from 0.
  ordinal INTEGER NOT NULL,
  -- Exact place in the source, e.g. 'SFS 1982:80 7 §'.
  source_ref TEXT NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  UNIQUE (document_id, ordinal)
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  area TEXT NOT NULL
);

CREATE TABLE chunk_tags (
  chunk_id INTEGER NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  -- Which model and vocabulary version produced the tag, so re-runs can skip or redo it.
  model TEXT NOT NULL,
  vocabulary_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chunk_id, tag_id)
) WITHOUT ROWID;

-- Tag → chunk lookups (the primary key already covers chunk → tag).
CREATE INDEX chunk_tags_tag_id ON chunk_tags (tag_id);
