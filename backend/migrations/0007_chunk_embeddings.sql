-- One embedding per chunk (E8-4), from `npm run index:embed`. `model`, `dtype` and `text_hash` say
-- what was embedded, so a changed text, model or precision makes the row stale and re-embedded.

CREATE TABLE chunk_embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks (id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dtype TEXT NOT NULL,
  -- SHA-256 of the embedded text (the chunk's heading path and text).
  text_hash TEXT NOT NULL,
  -- The unit-length dense vector as little-endian float32.
  dense BLOB NOT NULL,
  created_at TEXT NOT NULL
);
