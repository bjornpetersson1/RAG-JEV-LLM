-- SubQ judges too (E9-1): `judge_cache.judge` also allows 'subq'. SQLite cannot change a CHECK
-- constraint in place, so the table is rebuilt with its rows.

CREATE TABLE judge_cache_new (
  -- SHA-256 of the normalized instruction, the judge implementation and its model.
  key TEXT NOT NULL,
  -- The judged chunk's id as the caller gives it; no foreign key, so the cache never blocks a
  -- re-import. `text_hash` makes a chunk whose text changed (or whose id was reused) a miss.
  chunk_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  judge TEXT NOT NULL CHECK (judge IN ('jev', 'subq', 'llm')),
  model TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, chunk_id)
);

INSERT INTO judge_cache_new SELECT key, chunk_id, text_hash, judge, model, score, created_at
FROM judge_cache;

DROP TABLE judge_cache;

ALTER TABLE judge_cache_new RENAME TO judge_cache;
