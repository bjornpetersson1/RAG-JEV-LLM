-- Judge scores per instruction and chunk (E5-2), so a repeated query makes no new judge calls.
-- Only the score is stored: whether a chunk is relevant depends on the threshold at read time.

CREATE TABLE judge_cache (
  -- SHA-256 of the normalized instruction, the judge implementation and its model.
  key TEXT NOT NULL,
  -- The judged chunk's id as the caller gives it; no foreign key, so the cache never blocks a
  -- re-import. `text_hash` makes a chunk whose text changed (or whose id was reused) a miss.
  chunk_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  judge TEXT NOT NULL CHECK (judge IN ('jev', 'llm')),
  model TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, chunk_id)
);
